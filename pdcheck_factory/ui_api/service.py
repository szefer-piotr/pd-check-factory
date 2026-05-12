from __future__ import annotations

import json
import os
from io import BytesIO
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

from openpyxl import load_workbook

from pdcheck_factory import blob_io, extraction_resolve, paths, pipeline_v2
from pdcheck_factory.json_util import read_json, write_json


class UiApiError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


STEP_ORDER: List[str] = [
    "extract-inputs",
    "index-protocol",
    "acrf-split-toc",
    "acrf-summary-text",
    "extract-rules",
    "extract-deviations",
    "review-and-finalize",
]

STEP_DEPENDENCIES: Dict[str, List[str]] = {
    "extract-inputs": [],
    "index-protocol": ["extract-inputs"],
    "acrf-split-toc": ["extract-inputs"],
    "acrf-summary-text": ["acrf-split-toc"],
    "extract-rules": ["index-protocol"],
    "extract-deviations": ["extract-rules", "acrf-summary-text"],
    "review-and-finalize": ["extract-deviations"],
}


@dataclass(frozen=True)
class StudyPaths:
    protocol_source: Path
    acrf_source: Path
    paragraph_index: Path
    acrf_sections_toc_dir: Path
    acrf_summary_text_merged: Path
    rules_parsed: Path
    deviations_parsed: Path
    deviations_review_state: Path
    deviations_validated: Path
    pseudo_logic_validated: Path
    final_json: Path
    final_xlsx: Path


@dataclass
class UiStepService:
    output_dir: Path

    def _study_paths(self, study_id: str) -> StudyPaths:
        proto = extraction_resolve.resolve_protocol_rendered_source_md(study_id, self.output_dir)
        acrf = extraction_resolve.resolve_acrf_rendered_source_md(study_id, self.output_dir)
        sections_toc = extraction_resolve.resolve_acrf_sections_toc_dir(study_id, self.output_dir)
        return StudyPaths(
            protocol_source=proto,
            acrf_source=acrf,
            paragraph_index=paths.local_protocol_paragraph_index_json(study_id, self.output_dir),
            acrf_sections_toc_dir=sections_toc,
            acrf_summary_text_merged=paths.local_acrf_summary_text_merged(study_id, self.output_dir),
            rules_parsed=paths.local_rules_parsed_json(study_id, self.output_dir),
            deviations_parsed=paths.local_deviations_parsed_json(study_id, self.output_dir),
            deviations_review_state=paths.local_deviations_review_state(study_id, self.output_dir),
            deviations_validated=paths.local_deviations_validated_json(study_id, self.output_dir),
            pseudo_logic_validated=paths.local_pseudo_logic_validated_json(study_id, self.output_dir),
            final_json=paths.local_final_deviations_json(study_id, self.output_dir),
            final_xlsx=paths.local_final_deviations_xlsx(study_id, self.output_dir),
        )

    def _require_study_id(self, study_id: str) -> str:
        normalized = (study_id or "").strip()
        if not normalized:
            raise UiApiError("VALIDATION_ERROR", "studyId is required", 400)
        return normalized

    def _assert_step_dependencies(self, statuses: Dict[str, str], step_id: str) -> None:
        for dependency in STEP_DEPENDENCIES.get(step_id, []):
            if statuses.get(dependency) != "done":
                raise UiApiError(
                    "STEP_BLOCKED",
                    f"Step '{step_id}' is blocked. Complete '{dependency}' first.",
                    409,
                )

    def _step_statuses(self, study_id: str) -> Dict[str, str]:
        p = self._study_paths(study_id)
        statuses: Dict[str, str] = {
            "extract-inputs": "done" if p.protocol_source.exists() and p.acrf_source.exists() else "pending",
            "index-protocol": "done" if p.paragraph_index.exists() else "pending",
            "acrf-split-toc": "done"
            if p.acrf_sections_toc_dir.exists() and any(p.acrf_sections_toc_dir.glob("*.md"))
            else "pending",
            "acrf-summary-text": "done" if p.acrf_summary_text_merged.exists() else "pending",
            "extract-rules": "done" if p.rules_parsed.exists() else "pending",
            "extract-deviations": "done" if p.deviations_parsed.exists() and p.deviations_review_state.exists() else "pending",
            "review-and-finalize": "done" if p.final_json.exists() and p.final_xlsx.exists() else "pending",
        }
        return statuses

    def _read_excerpt(self, file_path: Path, max_chars: int = 2500) -> str:
        if not file_path.exists() or not file_path.is_file():
            return ""
        return file_path.read_text(encoding="utf-8")[:max_chars]

    def _load_state(self, study_id: str) -> Dict[str, Any]:
        path = paths.local_deviations_review_state(study_id, self.output_dir)
        if not path.is_file():
            raise UiApiError("NOT_FOUND", f"Missing review state: {path}", 404)
        return read_json(path)

    def _load_pseudo_state(self, study_id: str) -> Dict[str, Any]:
        path = paths.local_pseudo_logic_review_state(study_id, self.output_dir)
        if path.is_file():
            return read_json(path)
        return {
            "schema_version": "1.0.0",
            "study_id": study_id,
            "generated_at": "",
            "items": [],
        }

    def _load_rules(self, study_id: str) -> Dict[str, Any]:
        path = paths.local_rules_parsed_json(study_id, self.output_dir)
        if path.is_file():
            return read_json(path)
        return {
            "schema_version": "1.0.0",
            "study_id": study_id,
            "generated_at": "",
            "rules": [],
        }

    def _save_rules(self, study_id: str, rules_obj: Dict[str, Any]) -> None:
        rules_obj["schema_version"] = rules_obj.get("schema_version", "1.0.0")
        rules_obj["study_id"] = study_id
        if not rules_obj.get("generated_at"):
            rules_obj["generated_at"] = datetime.now(timezone.utc).isoformat()
        write_json(paths.local_rules_parsed_json(study_id, self.output_dir), rules_obj)

    def _load_paragraph_index(self, study_id: str) -> Dict[str, Dict[str, Any]]:
        path = paths.local_protocol_paragraph_index_json(study_id, self.output_dir)
        if not path.is_file():
            return {}
        obj = read_json(path)
        paragraphs = obj.get("paragraphs", [])
        by_ref: Dict[str, Dict[str, Any]] = {}
        if isinstance(paragraphs, list):
            for paragraph in paragraphs:
                if not isinstance(paragraph, dict):
                    continue
                ref = str(
                    paragraph.get("paragraph_id")
                    or paragraph.get("id")
                    or paragraph.get("ref")
                    or paragraph.get("paragraph_ref")
                    or ""
                )
                if ref:
                    by_ref[ref] = paragraph
        return by_ref

    def _chat_state_path(self, study_id: str) -> Path:
        return paths.local_review_dir(study_id, self.output_dir) / "deviation_chat_state.json"

    def _load_chat_state(self, study_id: str) -> Dict[str, Any]:
        chat_path = self._chat_state_path(study_id)
        if chat_path.is_file():
            return read_json(chat_path)
        return {
            "schema_version": "1.0.0",
            "study_id": study_id,
            "updated_at": "",
            "deviations": {},
        }

    def _save_chat_state(self, study_id: str, chat_obj: Dict[str, Any]) -> None:
        chat_obj["updated_at"] = datetime.now(timezone.utc).isoformat()
        write_json(self._chat_state_path(study_id), chat_obj)

    def _append_chat_message(
        self,
        chat_obj: Dict[str, Any],
        deviation_id: str,
        *,
        role: str,
        text: str,
    ) -> None:
        dev_key = str(deviation_id)
        by_dev = dict(chat_obj.get("deviations", {}))
        cur = dict(by_dev.get(dev_key, {"messages": []}))
        msgs = list(cur.get("messages", []))
        msgs.append(
            {
                "role": role,
                "text": text,
                "ts": datetime.now(timezone.utc).isoformat(),
            }
        )
        cur["messages"] = msgs[-25:]
        by_dev[dev_key] = cur
        chat_obj["deviations"] = by_dev

    def _replace_row(self, state_obj: Dict[str, Any], updated_row: Dict[str, Any]) -> Dict[str, Any]:
        dev_id = str(updated_row.get("deviation_id", ""))
        rows = list(state_obj.get("deviations", []))
        for idx, row in enumerate(rows):
            if str(row.get("deviation_id", "")) == dev_id:
                rows[idx] = updated_row
                break
        state_obj["deviations"] = rows
        return state_obj

    def _persist_state(self, study_id: str, state_obj: Dict[str, Any], audit_obj: Dict[str, Any]) -> None:
        state_obj["schema_version"] = state_obj.get("schema_version", "1.0.0")
        state_obj["study_id"] = study_id
        if not state_obj.get("generated_at"):
            state_obj["generated_at"] = datetime.now(timezone.utc).isoformat()
        write_json(paths.local_deviations_review_state(study_id, self.output_dir), state_obj)
        write_json(paths.local_deviations_validated_json(study_id, self.output_dir), state_obj)
        write_json(paths.local_deviations_review_audit_json(study_id, self.output_dir), audit_obj)

    def _audit(self, study_id: str, *, action: str, target_id: str, updated_rows: int) -> Dict[str, Any]:
        return {
            "study_id": study_id,
            "review_type": "deviations",
            "action": action,
            "target_id": target_id,
            "updated_rows": updated_rows,
            "revised_rows": 0,
            "run_revision_cycle": False,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }

    def _normalize_refs(self, value: Any) -> List[str]:
        if isinstance(value, list):
            refs = [str(item).strip() for item in value if str(item).strip()]
        else:
            refs = [part.strip() for part in str(value or "").replace(";", ",").split(",") if part.strip()]
        if not refs:
            raise UiApiError("VALIDATION_ERROR", "paragraph_refs is required", 400)
        invalid = [ref for ref in refs if not ref.startswith("p") or not ref[1:].isdigit()]
        if invalid:
            raise UiApiError("VALIDATION_ERROR", f"Invalid paragraph_refs: {', '.join(invalid)}", 400)
        return refs

    def _normalize_deviation_payload(self, payload: Dict[str, Any], *, default_source: str) -> Dict[str, Any]:
        deviation_id = str(payload.get("deviation_id") or payload.get("deviationId") or "").strip()
        rule_id = str(payload.get("rule_id") or payload.get("ruleId") or "").strip()
        text = str(payload.get("text") or payload.get("deviation_text") or payload.get("deviationText") or "").strip()
        if not deviation_id or not rule_id or not text:
            raise UiApiError("VALIDATION_ERROR", "deviation_id, rule_id, and text are required", 400)
        status = str(payload.get("status") or "pending").strip().lower()
        if status not in {"pending", "accepted", "to_review", "rejected"}:
            raise UiApiError("VALIDATION_ERROR", "status must be one of pending,accepted,to_review,rejected", 400)
        return {
            "deviation_id": deviation_id,
            "rule_id": rule_id,
            "text": text,
            "paragraph_refs": self._normalize_refs(payload.get("paragraph_refs") or payload.get("paragraphRefs")),
            "data_support_note": str(payload.get("data_support_note") or payload.get("dataSupportNote") or ""),
            "status": status,
            "dm_comment": str(payload.get("dm_comment") or payload.get("dmComment") or ""),
            "entry_source": str(payload.get("entry_source") or payload.get("entrySource") or default_source),
        }

    def _normalized_rule_payload(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        rule_id = str(payload.get("rule_id") or payload.get("ruleId") or "").strip()
        title = str(payload.get("title") or payload.get("rule_title") or payload.get("ruleTitle") or "").strip()
        text = str(payload.get("text") or payload.get("rule_text") or payload.get("ruleText") or "").strip()
        if not rule_id:
            raise UiApiError("VALIDATION_ERROR", "rule_id is required", 400)
        refs_value = payload.get("paragraph_refs") or payload.get("paragraphRefs")
        return {
            "rule_id": rule_id,
            "title": title,
            "text": text,
            "paragraph_refs": self._normalize_refs(refs_value) if refs_value else [],
        }

    def _normalized_step7_row(
        self,
        row: Dict[str, Any],
        pseudo_by_dev: Dict[str, Dict[str, Any]],
        rule_by_id: Dict[str, Dict[str, Any]],
        paragraph_by_ref: Dict[str, Dict[str, Any]] | None = None,
    ) -> Dict[str, Any]:
        deviation_id = str(row.get("deviation_id", ""))
        rule_id = str(row.get("rule_id", ""))
        pseudo = pseudo_by_dev.get(deviation_id, {})
        rule = rule_by_id.get(rule_id, {})
        refs = list(row.get("paragraph_refs", []))
        paragraph_lookup = paragraph_by_ref or {}
        supporting_sentences = []
        for ref in refs:
            paragraph = paragraph_lookup.get(str(ref), {})
            text = str(paragraph.get("text") or paragraph.get("content") or paragraph.get("paragraph_text") or "")
            supporting_sentences.append({"ref": str(ref), "text": text})
        return {
            "rule_id": rule_id,
            "deviation_id": deviation_id,
            "rule_title": str(rule.get("title", "")),
            "rule_text": str(rule.get("text") or rule.get("rule_text") or rule.get("description") or ""),
            "deviation_text": str(row.get("text", "")),
            "paragraph_refs": refs,
            "paragraph_refs_text": ", ".join(refs),
            "supporting_sentences": supporting_sentences,
            "data_support_note": str(row.get("data_support_note", "")),
            "pseudo_logic": str(pseudo.get("pseudo_logic", "")),
            "status": str(row.get("status", "pending")),
            "dm_comment": str(row.get("dm_comment", "")),
            "entry_source": str(row.get("entry_source", "extracted")),
            "programmable": pseudo.get("programmable"),
            "programmability_note": str(pseudo.get("programmability_note", "")),
        }

    def list_studies(self) -> Dict[str, Any]:
        blob_service = blob_io.blob_service_from_env()
        container = blob_io.container_from_env()
        names = blob_io.list_blob_names_with_prefix(
            blob_service=blob_service,
            container_name=container,
            prefix="raw/",
        )
        by_study: Dict[str, set[str]] = {}
        for name in names:
            parts = name.strip("/").split("/")
            if len(parts) != 3 or parts[0] != "raw":
                continue
            study_id, file_name = parts[1], parts[2]
            if file_name in {"protocol.pdf", "acrf.pdf"}:
                by_study.setdefault(study_id, set()).add(file_name)

        studies = []
        for study_id in sorted(by_study):
            if {"protocol.pdf", "acrf.pdf"}.issubset(by_study[study_id]):
                statuses = self._step_statuses(study_id)
                studies.append(
                    {
                        "studyId": study_id,
                        "protocolBlob": paths.raw_protocol_blob(study_id),
                        "acrfBlob": paths.raw_acrf_blob(study_id),
                        "stepStatuses": statuses,
                        "nextStepId": next((step_id for step_id in STEP_ORDER if statuses[step_id] != "done"), None),
                    }
                )
        return {"studies": studies}

    def upload_step1_files(self, study_id: str, protocol_bytes: bytes, acrf_bytes: bytes) -> Dict[str, Any]:
        study_id = self._require_study_id(study_id)
        if not protocol_bytes or not acrf_bytes:
            raise UiApiError("VALIDATION_ERROR", "protocolFile and acrfFile must not be empty", 400)

        max_mb = int(os.getenv("UI_UPLOAD_MAX_MB", "100"))
        max_bytes = max_mb * 1024 * 1024
        if len(protocol_bytes) > max_bytes or len(acrf_bytes) > max_bytes:
            raise UiApiError("VALIDATION_ERROR", f"Uploaded files must be <= {max_mb}MB each", 400)

        blob_service = blob_io.blob_service_from_env()
        container = blob_io.container_from_env()
        protocol_blob = paths.raw_protocol_blob(study_id)
        acrf_blob = paths.raw_acrf_blob(study_id)

        blob_io.upload_blob_bytes(
            blob_service=blob_service,
            container_name=container,
            blob_path=protocol_blob,
            data=protocol_bytes,
            content_type="application/pdf",
        )
        blob_io.upload_blob_bytes(
            blob_service=blob_service,
            container_name=container,
            blob_path=acrf_blob,
            data=acrf_bytes,
            content_type="application/pdf",
        )

        return {
            "studyId": study_id,
            "protocolBlob": protocol_blob,
            "acrfBlob": acrf_blob,
            "protocolSize": len(protocol_bytes),
            "acrfSize": len(acrf_bytes),
            "stepStatuses": self._step_statuses(study_id),
        }

    def run_step1_extract(self, study_id: str, extractor: str | None = None) -> Dict[str, Any]:
        from pdcheck_factory.cli import run_extract

        study_id = self._require_study_id(study_id)
        raw = (extractor or "").strip().lower()
        if not raw:
            mode = extraction_resolve.UI_EXTRACTOR_BOTH
        elif raw in extraction_resolve.VALID_UI_EXTRACTORS:
            mode = raw
        else:
            raise UiApiError(
                "VALIDATION_ERROR",
                "extractor must be 'opendataloader', 'document_intelligence', or 'both'.",
                400,
            )

        run_odl = mode != extraction_resolve.UI_EXTRACTOR_DI
        odl_only = mode == extraction_resolve.UI_EXTRACTOR_OPEN

        run_extract(
            study_id=study_id,
            protocol_blob=None,
            acrf_blob=None,
            output_dir=self.output_dir,
            model_id=None,
            sas_ttl=int(os.getenv("DI_SAS_TTL_MINUTES", "15")),
            upload=True,
            skip_acrf=False,
            skip_protocol=False,
            upload_only=False,
            run_opendataloader_ocr=run_odl,
            opendataloader_only=odl_only,
            debug_blob=False,
        )
        extraction_resolve.write_ui_extractor_choice(study_id, self.output_dir, mode)
        return {
            "studyId": study_id,
            "message": "Extraction completed",
            "extractor": mode,
            "stepStatuses": self._step_statuses(study_id),
        }

    def get_step1_preview(self, study_id: str) -> Dict[str, Any]:
        study_id = self._require_study_id(study_id)
        p = self._study_paths(study_id)
        return {
            "studyId": study_id,
            "protocolPreview": self._read_excerpt(p.protocol_source),
            "acrfPreview": self._read_excerpt(p.acrf_source),
            "protocolPreviewPath": str(p.protocol_source),
            "acrfPreviewPath": str(p.acrf_source),
            "protocolExists": p.protocol_source.exists(),
            "acrfExists": p.acrf_source.exists(),
            "extractor": extraction_resolve.read_ui_extractor_choice(study_id, self.output_dir),
            "stepStatuses": self._step_statuses(study_id),
        }

    def get_status(self, study_id: str) -> Dict[str, Any]:
        study_id = self._require_study_id(study_id)
        statuses = self._step_statuses(study_id)
        return {
            "studyId": study_id,
            "steps": [{"stepId": step_id, "status": statuses[step_id]} for step_id in STEP_ORDER],
            "nextStepId": next((step_id for step_id in STEP_ORDER if statuses[step_id] != "done"), None),
        }

    def run_step(self, study_id: str, step_id: str) -> Dict[str, Any]:
        study_id = self._require_study_id(study_id)
        if step_id not in STEP_ORDER:
            raise UiApiError("NOT_FOUND", f"Unknown stepId '{step_id}'", 404)

        statuses = self._step_statuses(study_id)
        self._assert_step_dependencies(statuses, step_id)

        if step_id == "index-protocol":
            result = pipeline_v2.step2_protocol_paragraph_index(study_id, self.output_dir)
            summary = f"Indexed {len(result.get('paragraphs', []))} protocol paragraphs."
        elif step_id == "acrf-split-toc":
            from pdcheck_factory.cli import run_acrf_split_toc

            p = self._study_paths(study_id)
            if not p.acrf_source.exists():
                raise UiApiError("STEP_BLOCKED", f"Missing aCRF source markdown: {p.acrf_source}", 409)
            count, _manifest_path = run_acrf_split_toc(
                source_md=p.acrf_source,
                destination_dir=p.acrf_sections_toc_dir,
                write_manifest=True,
            )
            summary = f"Split aCRF markdown into {count} TOC section files."
        elif step_id == "acrf-summary-text":
            result = pipeline_v2.step1_acrf_summary_text(study_id, self.output_dir)
            summary = f"Merged aCRF summary text with {len(result.get('datasets', []))} datasets."
        elif step_id == "extract-rules":
            result = pipeline_v2.step3_extract_rules(study_id, self.output_dir)
            summary = f"Extracted {len(result.get('rules', []))} rules."
        elif step_id == "extract-deviations":
            result = pipeline_v2.step4_5_extract_deviations(study_id, self.output_dir)
            pipeline_v2.initialize_review_states(study_id, self.output_dir)
            summary = f"Extracted {len(result.get('deviations', []))} deviations and initialized review state."
        elif step_id == "review-and-finalize":
            validated_path = paths.local_deviations_validated_json(study_id, self.output_dir)
            if not validated_path.exists():
                review_state_path = paths.local_deviations_review_state(study_id, self.output_dir)
                if review_state_path.exists():
                    validated_path.parent.mkdir(parents=True, exist_ok=True)
                    validated_path.write_text(review_state_path.read_text(encoding="utf-8"), encoding="utf-8")
                else:
                    raise UiApiError(
                        "STEP_BLOCKED",
                        "Missing deviation review state; run extract-deviations first.",
                        409,
                    )
            pseudo = pipeline_v2.step8_generate_pseudo_logic(study_id, self.output_dir)
            final = pipeline_v2.step10_finalize(study_id, self.output_dir)
            summary = (
                f"Generated pseudo logic for {len(pseudo.get('items', []))} accepted deviations and "
                f"finalized {len(final.get('items', []))} output rows."
            )
        else:
            raise UiApiError("STEP_BLOCKED", f"Step '{step_id}' must be run via dedicated endpoint.", 409)

        return {
            "studyId": study_id,
            "stepId": step_id,
            "summary": summary,
            "stepStatuses": self._step_statuses(study_id),
        }

    def get_step_preview(self, study_id: str, step_id: str) -> Dict[str, Any]:
        study_id = self._require_study_id(study_id)
        if step_id not in STEP_ORDER:
            raise UiApiError("NOT_FOUND", f"Unknown stepId '{step_id}'", 404)

        p = self._study_paths(study_id)
        previews: List[Dict[str, Any]] = []

        if step_id == "index-protocol":
            previews.append(
                {
                    "title": "Paragraph index preview",
                    "body": self._read_excerpt(p.paragraph_index),
                    "highlight": True,
                }
            )
        elif step_id == "acrf-split-toc":
            previews.append(
                {
                    "title": "aCRF sections_toc directory",
                    "body": str(p.acrf_sections_toc_dir),
                    "highlight": True,
                }
            )
        elif step_id == "acrf-summary-text":
            previews.append(
                {
                    "title": "aCRF merged summary preview",
                    "body": self._read_excerpt(p.acrf_summary_text_merged),
                    "highlight": True,
                }
            )
        elif step_id == "extract-rules":
            previews.append(
                {
                    "title": "Rules preview",
                    "body": self._read_excerpt(p.rules_parsed),
                    "highlight": True,
                }
            )
        elif step_id == "extract-deviations":
            previews.append(
                {
                    "title": "Deviations preview",
                    "body": self._read_excerpt(p.deviations_parsed),
                    "highlight": True,
                }
            )
            previews.append(
                {
                    "title": "Review state preview",
                    "body": self._read_excerpt(p.deviations_review_state),
                }
            )
        elif step_id == "review-and-finalize":
            previews.append(
                {
                    "title": "Final JSON preview",
                    "body": self._read_excerpt(p.final_json),
                    "highlight": True,
                }
            )
            previews.append(
                {
                    "title": "Final XLSX path",
                    "body": str(p.final_xlsx) if p.final_xlsx.exists() else "No final workbook generated yet.",
                }
            )

        return {
            "studyId": study_id,
            "stepId": step_id,
            "previews": previews,
            "stepStatuses": self._step_statuses(study_id),
        }

    def get_step7_deviations(self, study_id: str) -> Dict[str, Any]:
        study_id = self._require_study_id(study_id)
        state_obj = self._load_state(study_id)
        pseudo_obj = self._load_pseudo_state(study_id)
        rules_obj = self._load_rules(study_id)
        paragraph_by_ref = self._load_paragraph_index(study_id)
        pseudo_by_dev = {str(item.get("deviation_id", "")): item for item in pseudo_obj.get("items", [])}
        rule_by_id = {str(rule.get("rule_id", "")): rule for rule in rules_obj.get("rules", [])}
        rows = [
            self._normalized_step7_row(row, pseudo_by_dev, rule_by_id, paragraph_by_ref)
            for row in state_obj.get("deviations", [])
        ]
        return {
            "studyId": study_id,
            "columns": [
                "rule_id",
                "deviation_id",
                "rule_title",
                "deviation_text",
                "paragraph_refs",
                "pseudo_logic",
            ],
            "rows": rows,
            "stepStatuses": self._step_statuses(study_id),
        }

    def create_step7_deviation(self, study_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        study_id = self._require_study_id(study_id)
        new_row = self._normalize_deviation_payload(payload, default_source="imported")
        state_obj = self._load_state(study_id)
        rows = list(state_obj.get("deviations", []))
        if any(str(row.get("deviation_id", "")) == new_row["deviation_id"] for row in rows):
            raise UiApiError("VALIDATION_ERROR", f"Duplicate deviation_id '{new_row['deviation_id']}'", 400)
        rows.append(new_row)
        state_obj["deviations"] = rows
        self._persist_state(study_id, state_obj, self._audit(study_id, action="create_deviation", target_id=new_row["deviation_id"], updated_rows=1))
        return self.get_step7_deviations(study_id)

    def patch_step7_deviation_fields(self, study_id: str, deviation_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        study_id = self._require_study_id(study_id)
        dev_id = str(deviation_id).strip()
        state_obj = self._load_state(study_id)
        rows = list(state_obj.get("deviations", []))
        row = next((item for item in rows if str(item.get("deviation_id", "")) == dev_id), None)
        if row is None:
            raise UiApiError("NOT_FOUND", f"Unknown deviationId '{dev_id}'", 404)
        merged = dict(row)
        for source_key, target_key in [
            ("rule_id", "rule_id"),
            ("ruleId", "rule_id"),
            ("text", "text"),
            ("deviation_text", "text"),
            ("deviationText", "text"),
            ("data_support_note", "data_support_note"),
            ("dataSupportNote", "data_support_note"),
            ("dm_comment", "dm_comment"),
            ("dmComment", "dm_comment"),
            ("status", "status"),
        ]:
            if source_key in payload:
                merged[target_key] = payload[source_key]
        if "paragraph_refs" in payload or "paragraphRefs" in payload:
            merged["paragraph_refs"] = payload.get("paragraph_refs") or payload.get("paragraphRefs")
        normalized = self._normalize_deviation_payload(merged, default_source=str(row.get("entry_source", "extracted")))
        normalized["deviation_id"] = dev_id
        state_obj = self._replace_row(state_obj, normalized)
        self._persist_state(study_id, state_obj, self._audit(study_id, action="update_deviation", target_id=dev_id, updated_rows=1))
        return self._single_step7_deviation_response(study_id, normalized)

    def delete_step7_deviation(self, study_id: str, deviation_id: str) -> Dict[str, Any]:
        study_id = self._require_study_id(study_id)
        dev_id = str(deviation_id).strip()
        state_obj = self._load_state(study_id)
        rows = list(state_obj.get("deviations", []))
        next_rows = [row for row in rows if str(row.get("deviation_id", "")) != dev_id]
        if len(next_rows) == len(rows):
            raise UiApiError("NOT_FOUND", f"Unknown deviationId '{dev_id}'", 404)
        state_obj["deviations"] = next_rows
        self._persist_state(study_id, state_obj, self._audit(study_id, action="delete_deviation", target_id=dev_id, updated_rows=1))

        pseudo_obj = self._load_pseudo_state(study_id)
        pseudo_items = [item for item in pseudo_obj.get("items", []) if str(item.get("deviation_id", "")) != dev_id]
        if len(pseudo_items) != len(pseudo_obj.get("items", [])):
            pseudo_obj["items"] = pseudo_items
            write_json(paths.local_pseudo_logic_review_state(study_id, self.output_dir), pseudo_obj)
            write_json(paths.local_pseudo_logic_validated_json(study_id, self.output_dir), pseudo_obj)
        return self.get_step7_deviations(study_id)

    def import_step7_deviations_xlsx(self, study_id: str, workbook_bytes: bytes) -> Dict[str, Any]:
        study_id = self._require_study_id(study_id)
        if not workbook_bytes:
            raise UiApiError("VALIDATION_ERROR", "Workbook must not be empty", 400)
        try:
            workbook = load_workbook(BytesIO(workbook_bytes), read_only=True, data_only=True)
            sheet = workbook.active
        except Exception as exc:  # noqa: BLE001
            raise UiApiError("VALIDATION_ERROR", "Workbook must be a readable .xlsx file", 400) from exc

        rows_iter = sheet.iter_rows(values_only=True)
        headers = next(rows_iter, None)
        if not headers:
            raise UiApiError("VALIDATION_ERROR", "Workbook must include a header row", 400)
        header_map = {str(value or "").strip().lower(): index for index, value in enumerate(headers)}

        def cell(row_values: tuple[Any, ...], *names: str) -> Any:
            for name in names:
                idx = header_map.get(name)
                if idx is not None and idx < len(row_values):
                    return row_values[idx]
            return ""

        imported: List[Dict[str, Any]] = []
        for row_values in rows_iter:
            if not row_values or not any(value is not None and str(value).strip() for value in row_values):
                continue
            imported.append(
                self._normalize_deviation_payload(
                    {
                        "deviation_id": cell(row_values, "deviation_id", "deviationid"),
                        "rule_id": cell(row_values, "rule_id", "ruleid"),
                        "text": cell(row_values, "text", "deviation_text", "deviationtext"),
                        "paragraph_refs": cell(row_values, "paragraph_refs", "paragraphrefs"),
                        "data_support_note": cell(row_values, "data_support_note", "datasupportnote"),
                        "dm_comment": cell(row_values, "dm_comment", "dmcomment"),
                        "status": cell(row_values, "status") or "pending",
                    },
                    default_source="imported",
                )
            )

        if not imported:
            raise UiApiError("VALIDATION_ERROR", "Workbook did not contain any deviation rows", 400)

        state_obj = self._load_state(study_id)
        existing_ids = {str(row.get("deviation_id", "")) for row in state_obj.get("deviations", [])}
        imported_ids = [row["deviation_id"] for row in imported]
        duplicate_ids = sorted({dev_id for dev_id in imported_ids if imported_ids.count(dev_id) > 1 or dev_id in existing_ids})
        if duplicate_ids:
            raise UiApiError("VALIDATION_ERROR", f"Duplicate deviation_id values: {', '.join(duplicate_ids)}", 400)

        state_obj["deviations"] = list(state_obj.get("deviations", [])) + imported
        self._persist_state(study_id, state_obj, self._audit(study_id, action="import_deviations", target_id="xlsx", updated_rows=len(imported)))
        payload = self.get_step7_deviations(study_id)
        payload["imported"] = len(imported)
        return payload

    def _single_step7_deviation_response(self, study_id: str, row: Dict[str, Any]) -> Dict[str, Any]:
        pseudo_obj = self._load_pseudo_state(study_id)
        rules_obj = self._load_rules(study_id)
        paragraph_by_ref = self._load_paragraph_index(study_id)
        pseudo_by_dev = {str(item.get("deviation_id", "")): item for item in pseudo_obj.get("items", [])}
        rule_by_id = {str(rule.get("rule_id", "")): rule for rule in rules_obj.get("rules", [])}
        dev_id = str(row.get("deviation_id", ""))
        return {
            "studyId": study_id,
            "deviationId": dev_id,
            "row": self._normalized_step7_row(row, pseudo_by_dev, rule_by_id, paragraph_by_ref),
            "stepStatuses": self._step_statuses(study_id),
        }

    def create_step7_rule(self, study_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        study_id = self._require_study_id(study_id)
        rule = self._normalized_rule_payload(payload)
        rules_obj = self._load_rules(study_id)
        rules = list(rules_obj.get("rules", []))
        if any(str(item.get("rule_id", "")) == rule["rule_id"] for item in rules):
            raise UiApiError("VALIDATION_ERROR", f"Duplicate rule_id '{rule['rule_id']}'", 400)
        rules.append(rule)
        rules_obj["rules"] = rules
        self._save_rules(study_id, rules_obj)
        return {"studyId": study_id, "rule": rule, "stepStatuses": self._step_statuses(study_id)}

    def update_step7_rule(self, study_id: str, rule_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        study_id = self._require_study_id(study_id)
        rid = str(rule_id).strip()
        rules_obj = self._load_rules(study_id)
        rules = list(rules_obj.get("rules", []))
        idx = next((i for i, item in enumerate(rules) if str(item.get("rule_id", "")) == rid), None)
        if idx is None:
            raise UiApiError("NOT_FOUND", f"Unknown ruleId '{rid}'", 404)
        merged = dict(rules[idx])
        merged.update(payload)
        updated = self._normalized_rule_payload({**merged, "rule_id": rid})
        rules[idx] = updated
        rules_obj["rules"] = rules
        self._save_rules(study_id, rules_obj)
        return {"studyId": study_id, "rule": updated, "stepStatuses": self._step_statuses(study_id)}

    def delete_step7_rule(self, study_id: str, rule_id: str) -> Dict[str, Any]:
        study_id = self._require_study_id(study_id)
        rid = str(rule_id).strip()
        state_obj = self._load_state(study_id)
        if any(str(row.get("rule_id", "")) == rid for row in state_obj.get("deviations", [])):
            raise UiApiError("VALIDATION_ERROR", f"Rule '{rid}' is used by one or more deviations", 400)
        rules_obj = self._load_rules(study_id)
        rules = list(rules_obj.get("rules", []))
        next_rules = [rule for rule in rules if str(rule.get("rule_id", "")) != rid]
        if len(next_rules) == len(rules):
            raise UiApiError("NOT_FOUND", f"Unknown ruleId '{rid}'", 404)
        rules_obj["rules"] = next_rules
        self._save_rules(study_id, rules_obj)
        return {"studyId": study_id, "deletedRuleId": rid, "stepStatuses": self._step_statuses(study_id)}

    def get_step7_deviation_chat(self, study_id: str, deviation_id: str) -> Dict[str, Any]:
        study_id = self._require_study_id(study_id)
        dev_id = str(deviation_id).strip()
        if not dev_id:
            raise UiApiError("VALIDATION_ERROR", "deviationId is required", 400)
        chat_obj = self._load_chat_state(study_id)
        dev_chat = chat_obj.get("deviations", {}).get(dev_id, {})
        return {
            "studyId": study_id,
            "deviationId": dev_id,
            "messages": list(dev_chat.get("messages", []))[-25:],
        }

    def refine_step7_deviation(
        self,
        *,
        study_id: str,
        deviation_id: str,
        dm_comment: str,
        run_revision_cycle: bool = True,
    ) -> Dict[str, Any]:
        study_id = self._require_study_id(study_id)
        dev_id = str(deviation_id).strip()
        if not dev_id:
            raise UiApiError("VALIDATION_ERROR", "deviationId is required", 400)
        comment = str(dm_comment or "")

        state_obj = self._load_state(study_id)
        rows = list(state_obj.get("deviations", []))
        row = next((item for item in rows if str(item.get("deviation_id", "")) == dev_id), None)
        if row is None:
            raise UiApiError("NOT_FOUND", f"Unknown deviationId '{dev_id}'", 404)

        chat_obj = self._load_chat_state(study_id)
        self._append_chat_message(chat_obj, dev_id, role="dm", text=comment.strip() or "(empty)")
        try:
            revised_row, audit = pipeline_v2.refine_single_deviation_with_comment(
                study_id=study_id,
                output_dir=self.output_dir,
                row=row,
                dm_comment=comment,
                run_revision_cycle=run_revision_cycle,
            )
            self._append_chat_message(chat_obj, dev_id, role="assistant", text="Updated deviation from your message.")
        except Exception as exc:
            self._append_chat_message(chat_obj, dev_id, role="assistant", text=f"Refinement failed: {exc}")
            self._save_chat_state(study_id, chat_obj)
            raise UiApiError("REFINE_FAILED", str(exc), 500) from exc

        state_obj = self._replace_row(state_obj, revised_row)
        self._persist_state(study_id, state_obj, audit)
        self._save_chat_state(study_id, chat_obj)

        pseudo_obj = self._load_pseudo_state(study_id)
        rules_obj = read_json(paths.local_rules_parsed_json(study_id, self.output_dir))
        pseudo_by_dev = {str(item.get("deviation_id", "")): item for item in pseudo_obj.get("items", [])}
        rule_by_id = {str(rule.get("rule_id", "")): rule for rule in rules_obj.get("rules", [])}

        return {
            "studyId": study_id,
            "deviationId": dev_id,
            "row": self._normalized_step7_row(revised_row, pseudo_by_dev, rule_by_id),
            "messages": list(chat_obj.get("deviations", {}).get(dev_id, {}).get("messages", []))[-25:],
            "audit": audit,
            "stepStatuses": self._step_statuses(study_id),
        }

    def update_step7_deviation(
        self,
        *,
        study_id: str,
        deviation_id: str,
        status: str,
        dm_comment: str | None = None,
    ) -> Dict[str, Any]:
        study_id = self._require_study_id(study_id)
        dev_id = str(deviation_id).strip()
        next_status = str(status).strip().lower()
        if next_status not in {"pending", "to_review", "accepted", "rejected"}:
            raise UiApiError("VALIDATION_ERROR", "Invalid status value", 400)

        state_obj = self._load_state(study_id)
        row = next((item for item in state_obj.get("deviations", []) if str(item.get("deviation_id", "")) == dev_id), None)
        if row is None:
            raise UiApiError("NOT_FOUND", f"Unknown deviationId '{dev_id}'", 404)
        updated = dict(row)
        updated["status"] = next_status
        if dm_comment is not None:
            updated["dm_comment"] = dm_comment
        audit = {
            "study_id": study_id,
            "review_type": "deviations",
            "deviation_id": dev_id,
            "updated_rows": 1,
            "revised_rows": 0,
            "run_revision_cycle": False,
        }
        state_obj = self._replace_row(state_obj, updated)
        self._persist_state(study_id, state_obj, audit)

        pseudo_obj = self._load_pseudo_state(study_id)
        rules_obj = read_json(paths.local_rules_parsed_json(study_id, self.output_dir))
        pseudo_by_dev = {str(item.get("deviation_id", "")): item for item in pseudo_obj.get("items", [])}
        rule_by_id = {str(rule.get("rule_id", "")): rule for rule in rules_obj.get("rules", [])}
        return {
            "studyId": study_id,
            "deviationId": dev_id,
            "row": self._normalized_step7_row(updated, pseudo_by_dev, rule_by_id),
            "stepStatuses": self._step_statuses(study_id),
        }

    def generate_step7_pseudo_logic_for_deviation(
        self, study_id: str, deviation_id: str
    ) -> Dict[str, Any]:
        study_id = self._require_study_id(study_id)
        dev_id = str(deviation_id).strip()
        if not dev_id:
            raise UiApiError("VALIDATION_ERROR", "deviationId is required", 400)

        state_obj = self._load_state(study_id)
        row = next(
            (item for item in state_obj.get("deviations", []) if str(item.get("deviation_id", "")) == dev_id),
            None,
        )
        if row is None:
            raise UiApiError("NOT_FOUND", f"Unknown deviationId '{dev_id}'", 404)
        if str(row.get("status", "")) != "accepted":
            raise UiApiError(
                "STEP_BLOCKED",
                "Pseudo logic can only be generated for deviations with status='accepted'.",
                409,
            )

        try:
            pseudo_item = pipeline_v2.generate_pseudo_logic_for_deviation(
                study_id=study_id,
                output_dir=self.output_dir,
                deviation=row,
            )
        except Exception as exc:  # noqa: BLE001
            raise UiApiError("PSEUDO_LOGIC_FAILED", str(exc), 500) from exc

        pseudo_obj = self._load_pseudo_state(study_id)
        items = list(pseudo_obj.get("items", []))
        replaced = False
        for idx, existing in enumerate(items):
            if str(existing.get("deviation_id", "")) == dev_id:
                items[idx] = pseudo_item
                replaced = True
                break
        if not replaced:
            items.append(pseudo_item)
        pseudo_obj["schema_version"] = pseudo_obj.get("schema_version", "1.0.0")
        pseudo_obj["study_id"] = study_id
        pseudo_obj["generated_at"] = datetime.now(timezone.utc).isoformat()
        pseudo_obj["items"] = items
        write_json(paths.local_pseudo_logic_review_state(study_id, self.output_dir), pseudo_obj)
        write_json(paths.local_pseudo_logic_validated_json(study_id, self.output_dir), pseudo_obj)

        rules_obj = read_json(paths.local_rules_parsed_json(study_id, self.output_dir))
        pseudo_by_dev = {str(item.get("deviation_id", "")): item for item in items}
        rule_by_id = {str(rule.get("rule_id", "")): rule for rule in rules_obj.get("rules", [])}
        return {
            "studyId": study_id,
            "deviationId": dev_id,
            "row": self._normalized_step7_row(row, pseudo_by_dev, rule_by_id),
            "stepStatuses": self._step_statuses(study_id),
        }

    def generate_step7_pseudo_logic_bulk(self, study_id: str) -> Dict[str, Any]:
        study_id = self._require_study_id(study_id)

        validated_path = paths.local_deviations_validated_json(study_id, self.output_dir)
        if not validated_path.exists():
            review_state_path = paths.local_deviations_review_state(study_id, self.output_dir)
            if not review_state_path.exists():
                raise UiApiError(
                    "STEP_BLOCKED",
                    "Missing deviation review state; run extract-deviations first.",
                    409,
                )
            validated_path.parent.mkdir(parents=True, exist_ok=True)
            validated_path.write_text(review_state_path.read_text(encoding="utf-8"), encoding="utf-8")

        try:
            pseudo_out = pipeline_v2.step8_generate_pseudo_logic(study_id, self.output_dir)
        except Exception as exc:  # noqa: BLE001
            raise UiApiError("PSEUDO_LOGIC_FAILED", str(exc), 500) from exc

        items = list(pseudo_out.get("items", []))
        state_obj = self._load_state(study_id)
        rules_obj = read_json(paths.local_rules_parsed_json(study_id, self.output_dir))
        pseudo_by_dev = {str(item.get("deviation_id", "")): item for item in items}
        rule_by_id = {str(rule.get("rule_id", "")): rule for rule in rules_obj.get("rules", [])}
        rows = [self._normalized_step7_row(row, pseudo_by_dev, rule_by_id) for row in state_obj.get("deviations", [])]
        return {
            "studyId": study_id,
            "generated": len(items),
            "rows": rows,
            "stepStatuses": self._step_statuses(study_id),
        }


def parse_json_body(raw: bytes) -> Dict[str, Any]:
    try:
        parsed = json.loads(raw.decode("utf-8"))
    except Exception as exc:  # noqa: BLE001
        raise UiApiError("BAD_JSON", "Request body must be valid JSON", 400) from exc
    if not isinstance(parsed, dict):
        raise UiApiError("BAD_JSON", "JSON body must be an object", 400)
    return parsed

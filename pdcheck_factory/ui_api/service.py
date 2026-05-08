from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List

from pdcheck_factory import blob_io, paths, pipeline_v2


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
        return StudyPaths(
            protocol_source=paths.local_extraction_opendataloader(study_id, "protocol", self.output_dir)
            / "rendered"
            / "source.md",
            acrf_source=paths.local_extraction_layout(study_id, "acrf", self.output_dir)
            / "rendered"
            / "source.md",
            paragraph_index=paths.local_protocol_paragraph_index_json(study_id, self.output_dir),
            acrf_sections_toc_dir=paths.local_extraction_layout(study_id, "acrf", self.output_dir)
            / "rendered"
            / "sections_toc",
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

    def run_step1_extract(self, study_id: str) -> Dict[str, Any]:
        from pdcheck_factory.cli import run_extract

        study_id = self._require_study_id(study_id)
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
            run_opendataloader_ocr=True,
            opendataloader_only=False,
            debug_blob=False,
        )
        return {
            "studyId": study_id,
            "message": "Extraction completed",
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


def parse_json_body(raw: bytes) -> Dict[str, Any]:
    try:
        parsed = json.loads(raw.decode("utf-8"))
    except Exception as exc:  # noqa: BLE001
        raise UiApiError("BAD_JSON", "Request body must be valid JSON", 400) from exc
    if not isinstance(parsed, dict):
        raise UiApiError("BAD_JSON", "JSON body must be an object", 400)
    return parsed

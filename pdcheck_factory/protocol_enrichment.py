"""Protocol enrichment for imported PD spec deviations (sequential LLM per deviation)."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Literal, Optional, Set

LlmProgressCallback = Callable[..., None]

from pydantic import BaseModel, ConfigDict, Field

from pdcheck_factory import llm, paths, study_artifact_sync, text_parse
from pdcheck_factory.import_grounding import build_deviations_state
from pdcheck_factory.json_util import load_schema, read_json, validate, write_json
from pdcheck_factory.deviation_contract import (
    build_enriched_row,
    filter_paragraph_refs,
    pd_spec_field,
    row_for_enrichment_llm,
)
from pdcheck_factory.pd_spec_import import parse_pd_spec_xlsx
from pdcheck_factory.prompt_loader import load_prompt

_ARTIFACT_SCHEMA_VERSION = "1.1.0"


class _StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class EnrichmentProposalOutput(_StrictModel):
    suggested_deviation_text: str = Field(min_length=1)
    paragraph_refs: List[str] = Field(default_factory=list)
    assumptions: List[str] = Field(default_factory=list)
    caveats: List[str] = Field(default_factory=list)
    data_gaps: List[str] = Field(default_factory=list)
    weak_spots: List[str] = Field(default_factory=list)
    suggested_changes: List[str] = Field(default_factory=list)
    protocol_conflicts: List[str] = Field(default_factory=list)
    programmability_risk: Literal["low", "medium", "high"] = "medium"


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _acrf_summary_text(study_id: str, output_dir: Path) -> str:
    summary = read_json(paths.local_acrf_summary_text_merged(study_id, output_dir))
    return json.dumps(summary, ensure_ascii=False, indent=2)


def _next_import_version(study_id: str, output_dir: Path) -> str:
    review_dir = paths.local_review_dir(study_id, output_dir)
    existing = sorted(review_dir.glob("deviations_import_*.json")) if review_dir.exists() else []
    return f"v{len(existing) + 1}"


def _numbered_protocol_text(index_obj: Dict[str, Any]) -> str:
    lines: List[str] = []
    for paragraph in index_obj.get("paragraphs", []):
        pid = str(paragraph.get("paragraph_id", ""))
        text = str(paragraph.get("text", ""))
        lines.append(f"{pid}: {text}")
    return "\n\n".join(lines)


def _format_supporting_paragraphs(
    paragraph_refs: List[str],
    index_obj: Dict[str, Any],
) -> str:
    paragraph_by_ref = {
        str(p.get("paragraph_id", "")): p for p in index_obj.get("paragraphs", [])
    }
    lines: List[str] = []
    for ref in paragraph_refs:
        paragraph = paragraph_by_ref.get(ref, {})
        text = str(paragraph.get("text", ""))[:2000]
        lines.append(f"{ref}: {text}")
    return "\n\n".join(lines) if lines else "(no supporting paragraphs)"


def _common_user_fields(
    *,
    study_id: str,
    deviation: Dict[str, Any],
) -> Dict[str, str]:
    flat = row_for_enrichment_llm(deviation)
    return {
        "study_id": study_id,
        "deviation_id": str(flat.get("deviation_id", "")),
        "protocol_deviation_category": str(flat.get("protocol_deviation_category", "")),
        "protocol_deviation_sub_category": str(flat.get("protocol_deviation_sub_category", "")),
        "classification": str(flat.get("classification", "")),
        "deviation_text": str(flat.get("text", "")),
    }


def _run_protocol_grounding(
    *,
    study_id: str,
    deviation: Dict[str, Any],
    protocol_paragraphs: str,
    valid_ids: Set[str],
) -> Dict[str, Any]:
    fields = _common_user_fields(study_id=study_id, deviation=deviation)
    fields["protocol_paragraphs"] = protocol_paragraphs

    def _validate(reply: str) -> Optional[str]:
        if text_parse.BEGIN_GROUNDING not in (reply or ""):
            return "Must contain <<<BEGIN_GROUNDING>>> block."
        parsed = text_parse.parse_import_grounding_block(reply)
        if not parsed:
            return "Grounding block missing required fields."
        for ref in parsed.get("paragraph_refs", []):
            if ref not in valid_ids:
                return f"paragraph_refs contains id not in protocol index: {ref}"
        return None

    try:
        reply = llm.chat_text_repairs(
            system=load_prompt("protocol_enrich_ground_protocol_system"),
            user=load_prompt("protocol_enrich_ground_protocol_user").format(**fields),
            validate_reply=_validate,
            max_repairs=2,
            label=f"protocol-enrich-ground-protocol-{fields['deviation_id']}",
        )
        parsed = text_parse.parse_import_grounding_block(reply) or {}
    except Exception as exc:  # noqa: BLE001
        parsed = {
            "paragraph_refs": [],
            "data_support_note": "",
            "grounding_error": str(exc),
        }

    refs = filter_paragraph_refs(list(parsed.get("paragraph_refs", [])), valid_ids)
    error = str(parsed.get("grounding_error", "") or "").strip()
    if error:
        refs = []
    elif not refs and not error:
        error = "No valid protocol paragraph references after filtering"

    return {
        "paragraph_refs": refs,
        "data_support_note": str(parsed.get("data_support_note", "") or "").strip(),
        "grounding_error": error,
    }


def _run_acrf_grounding(
    *,
    study_id: str,
    deviation: Dict[str, Any],
    protocol_grounding: Dict[str, Any],
    index_obj: Dict[str, Any],
    acrf_summary: str,
) -> Dict[str, Any]:
    fields = _common_user_fields(study_id=study_id, deviation=deviation)
    refs = list(protocol_grounding.get("paragraph_refs", []))
    fields["paragraph_refs"] = ", ".join(refs) or "(none)"
    fields["protocol_data_support_note"] = str(
        protocol_grounding.get("data_support_note", "") or ""
    )
    fields["protocol_supporting_paragraphs"] = _format_supporting_paragraphs(refs, index_obj)
    fields["acrf_summary"] = acrf_summary

    def _validate(reply: str) -> Optional[str]:
        if text_parse.BEGIN_ACRF_GROUNDING not in (reply or ""):
            return "Must contain <<<BEGIN_ACRF_GROUNDING>>> block."
        if not text_parse.parse_acrf_grounding_block(reply):
            return "aCRF grounding block missing required fields."
        return None

    try:
        reply = llm.chat_text_repairs(
            system=load_prompt("protocol_enrich_ground_acrf_system"),
            user=load_prompt("protocol_enrich_ground_acrf_user").format(**fields),
            validate_reply=_validate,
            max_repairs=2,
            label=f"protocol-enrich-ground-acrf-{fields['deviation_id']}",
        )
        parsed = text_parse.parse_acrf_grounding_block(reply) or {}
    except Exception as exc:  # noqa: BLE001
        parsed = {
            "pseudo_logic_plain_english": "",
            "programmable": "no",
            "programmability_risk": "high",
            "programmability_rationale": "",
            "acrf_sections": [],
            "data_support_note": "",
            "grounding_error": str(exc),
        }

    risk = str(parsed.get("programmability_risk", "medium") or "medium").lower()
    if risk not in {"low", "medium", "high"}:
        risk = "medium"

    return {
        "pseudo_logic_plain_english": str(
            parsed.get("pseudo_logic_plain_english", "") or ""
        ).strip(),
        "programmable": str(parsed.get("programmable", "") or "").strip().lower(),
        "programmability_risk": risk,
        "programmability_rationale": str(
            parsed.get("programmability_rationale", "") or ""
        ).strip(),
        "acrf_sections": list(parsed.get("acrf_sections", []) or []),
        "data_support_note": str(parsed.get("data_support_note", "") or "").strip(),
        "grounding_error": str(parsed.get("grounding_error", "") or "").strip(),
    }


def _run_enrichment_proposal(
    *,
    study_id: str,
    deviation: Dict[str, Any],
    original_deviation_text: str,
    protocol_grounding: Dict[str, Any],
    acrf_grounding: Dict[str, Any],
    index_obj: Dict[str, Any],
    valid_ids: Set[str],
) -> EnrichmentProposalOutput | None:
    fields = _common_user_fields(study_id=study_id, deviation=deviation)
    refs = list(protocol_grounding.get("paragraph_refs", []))
    fields["original_deviation_text"] = original_deviation_text
    fields["protocol_supporting_paragraphs"] = _format_supporting_paragraphs(refs, index_obj)
    fields["pseudo_logic_plain_english"] = str(
        acrf_grounding.get("pseudo_logic_plain_english", "") or ""
    )
    fields["programmable"] = str(acrf_grounding.get("programmable", "") or "")
    fields["programmability_risk"] = str(acrf_grounding.get("programmability_risk", "") or "")
    fields["programmability_rationale"] = str(
        acrf_grounding.get("programmability_rationale", "") or ""
    )
    fields["acrf_sections"] = ", ".join(acrf_grounding.get("acrf_sections", []) or [])
    fields["acrf_data_support_note"] = str(acrf_grounding.get("data_support_note", "") or "")

    try:
        raw = llm.chat_json(
            system=load_prompt("protocol_enrich_propose_system"),
            user=load_prompt("protocol_enrich_propose_user").format(**fields),
            response_model=EnrichmentProposalOutput,
            validator=lambda d: _validate_proposal_refs(d, valid_ids),
            max_repairs=2,
        )
        return EnrichmentProposalOutput.model_validate(raw)
    except Exception:  # noqa: BLE001
        return None


def _validate_proposal_refs(data: Dict[str, Any], valid_ids: Set[str]) -> List[str]:
    errs: List[str] = []
    for ref in data.get("paragraph_refs", []):
        if ref not in valid_ids:
            errs.append(f"paragraph_refs contains id not in protocol index: {ref}")
    return errs[:10]


def _merge_enrichment_results(
    *,
    deviation: Dict[str, Any],
    protocol_grounding: Dict[str, Any],
    acrf_grounding: Dict[str, Any],
    proposal: Optional[EnrichmentProposalOutput],
    valid_ids: Set[str],
    enrichment_errors: Dict[str, str],
) -> tuple[Dict[str, Any], Dict[str, Any]]:
    """Return (merged_sidecar, canonical row updates for build_enriched_row)."""
    original_deviation_text = str(deviation.get("text", ""))
    imported_text = original_deviation_text

    protocol_refs = filter_paragraph_refs(
        list(protocol_grounding.get("paragraph_refs", [])),
        valid_ids,
    )
    data_support_note = str(protocol_grounding.get("data_support_note", "") or "").strip()
    if acrf_grounding.get("data_support_note"):
        acrf_note = str(acrf_grounding.get("data_support_note", "")).strip()
        if acrf_note:
            data_support_note = acrf_note if not data_support_note else f"{data_support_note}; {acrf_note}"

    pseudo_seed = str(acrf_grounding.get("pseudo_logic_plain_english", "") or "").strip()
    if not pseudo_seed:
        pseudo_seed = pd_spec_field(deviation, "pseudo_logic_seed")

    suggested_text = ""
    assumptions: List[str] = []
    caveat_list: List[str] = []
    data_gaps: List[str] = []
    weak_spots: List[str] = []
    suggested_changes: List[str] = []
    protocol_conflicts: List[str] = []
    programmability_risk = str(acrf_grounding.get("programmability_risk", "medium") or "medium")

    if proposal:
        suggested_text = proposal.suggested_deviation_text.strip()
        if proposal.paragraph_refs:
            protocol_refs = filter_paragraph_refs(list(proposal.paragraph_refs), valid_ids) or protocol_refs
        assumptions = list(proposal.assumptions)
        caveat_list = list(proposal.caveats)
        data_gaps = list(proposal.data_gaps)
        weak_spots = list(proposal.weak_spots)
        suggested_changes = list(proposal.suggested_changes)
        protocol_conflicts = list(proposal.protocol_conflicts)
        programmability_risk = proposal.programmability_risk

    if enrichment_errors:
        enrichment_status = (
            "partial"
            if (protocol_grounding.get("paragraph_refs") or acrf_grounding or proposal)
            else "failed"
        )
    elif protocol_grounding.get("grounding_error") and not protocol_refs:
        enrichment_status = "partial"
    elif not proposal:
        enrichment_status = "partial"
    else:
        enrichment_status = "ok"

    needs_review = (
        programmability_risk == "high"
        or bool(protocol_conflicts)
        or bool(enrichment_errors)
        or bool(protocol_grounding.get("grounding_error"))
        or bool(acrf_grounding.get("grounding_error"))
        or not protocol_refs
        or not suggested_text
    )
    status = str(deviation.get("status") or "pending")
    if needs_review:
        status = "to_review"

    summary_parts: List[str] = []
    if programmability_risk != "low":
        summary_parts.append(f"Programmability risk: {programmability_risk}")
    if protocol_conflicts:
        summary_parts.append(f"{len(protocol_conflicts)} protocol conflict(s)")
    if weak_spots:
        summary_parts.append(f"{len(weak_spots)} weak spot(s)")
    if enrichment_errors:
        summary_parts.append(f"Step errors: {', '.join(enrichment_errors.keys())}")
    if protocol_grounding.get("grounding_error"):
        summary_parts.append("Protocol grounding issue")
    enrichment_summary = "; ".join(summary_parts) if summary_parts else "Enrichment complete"

    merged = {
        "original_deviation_text": original_deviation_text,
        "suggested_deviation_text": suggested_text,
        "improved_deviation_text": suggested_text,
        "improved_pseudo_logic_plain_english": pseudo_seed,
        "paragraph_refs": protocol_refs,
        "data_support_note": data_support_note,
        "assumptions": assumptions,
        "caveats": caveat_list,
        "data_gaps": data_gaps,
        "required_datasets": list(acrf_grounding.get("acrf_sections", []) or []),
        "required_fields": [],
        "weak_spots": weak_spots,
        "suggested_changes": suggested_changes,
        "protocol_conflicts": protocol_conflicts,
        "programmability_risk": programmability_risk,
    }

    row_updates: Dict[str, Any] = {
        "text": imported_text,
        "paragraph_refs": protocol_refs,
        "data_support_note": data_support_note,
        "status": status,
        "original_deviation_text": original_deviation_text,
        "suggested_deviation_text": suggested_text,
        "pd_spec_import": {
            "pseudo_logic_seed": pseudo_seed,
            "enrichment_status": enrichment_status,
            "enrichment_summary": enrichment_summary,
            "entry_source": "imported_pd_spec",
        },
    }
    return merged, row_updates


def _write_enrichment_artifact(
    *,
    study_id: str,
    output_dir: Path,
    deviation_id: str,
    artifact: Dict[str, Any],
) -> None:
    artifact_path = paths.local_protocol_enrichment_json(study_id, output_dir, deviation_id)
    artifact_path.parent.mkdir(parents=True, exist_ok=True)
    write_json(artifact_path, artifact)
    study_artifact_sync.mirror_upload_path(study_id, output_dir, artifact_path)


def enrich_imported_deviation(
    *,
    study_id: str,
    output_dir: Path,
    deviation: Dict[str, Any],
    index_obj: Dict[str, Any],
    acrf_summary: str,
    protocol_paragraphs: str,
) -> Dict[str, Any]:
    """Run three sequential enrichment LLM steps for one deviation."""
    valid_ids = {str(p.get("paragraph_id", "")) for p in index_obj.get("paragraphs", [])}
    deviation_id = str(deviation.get("deviation_id", ""))
    enrichment_errors: Dict[str, str] = {}

    protocol_grounding: Dict[str, Any] = {
        "paragraph_refs": [],
        "data_support_note": "",
        "grounding_error": "",
    }
    acrf_grounding: Dict[str, Any] = {
        "pseudo_logic_plain_english": "",
        "programmable": "",
        "programmability_risk": "medium",
        "programmability_rationale": "",
        "acrf_sections": [],
        "data_support_note": "",
        "grounding_error": "",
    }
    proposal: Optional[EnrichmentProposalOutput] = None

    try:
        protocol_grounding = _run_protocol_grounding(
            study_id=study_id,
            deviation=deviation,
            protocol_paragraphs=protocol_paragraphs,
            valid_ids=valid_ids,
        )
        if protocol_grounding.get("grounding_error"):
            enrichment_errors["protocol"] = str(protocol_grounding["grounding_error"])

        acrf_grounding = _run_acrf_grounding(
            study_id=study_id,
            deviation=deviation,
            protocol_grounding=protocol_grounding,
            index_obj=index_obj,
            acrf_summary=acrf_summary,
        )
        if acrf_grounding.get("grounding_error"):
            enrichment_errors["acrf"] = str(acrf_grounding["grounding_error"])

        original_text = str(deviation.get("text", ""))
        proposal = _run_enrichment_proposal(
            study_id=study_id,
            deviation=deviation,
            original_deviation_text=original_text,
            protocol_grounding=protocol_grounding,
            acrf_grounding=acrf_grounding,
            index_obj=index_obj,
            valid_ids=valid_ids,
        )
        if proposal is None:
            enrichment_errors["proposal"] = "Enrichment proposal step failed"
    except Exception as exc:  # noqa: BLE001
        enrichment_errors["enrichment"] = str(exc)

    merged, row_updates = _merge_enrichment_results(
        deviation=deviation,
        protocol_grounding=protocol_grounding,
        acrf_grounding=acrf_grounding,
        proposal=proposal,
        valid_ids=valid_ids,
        enrichment_errors=enrichment_errors,
    )

    if enrichment_errors and not proposal:
        row_updates.setdefault("pd_spec_import", {})["enrichment_status"] = (
            "partial" if protocol_grounding.get("paragraph_refs") or acrf_grounding else "failed"
        )

    artifact: Dict[str, Any] = {
        "schema_version": _ARTIFACT_SCHEMA_VERSION,
        "study_id": study_id,
        "deviation_id": deviation_id,
        "generated_at": _iso_now(),
        "enrichment_status": (row_updates.get("pd_spec_import") or {}).get("enrichment_status", "ok"),
        "enrichment_summary": (row_updates.get("pd_spec_import") or {}).get("enrichment_summary", ""),
        "enrichment_errors": enrichment_errors,
        "protocol_grounding": protocol_grounding,
        "acrf_grounding": acrf_grounding,
        "proposal": proposal.model_dump(mode="json") if proposal else None,
        "merged": merged,
    }

    _write_enrichment_artifact(
        study_id=study_id,
        output_dir=output_dir,
        deviation_id=deviation_id,
        artifact=artifact,
    )

    return build_enriched_row(deviation, row_updates)


def run_protocol_enrichment(
    study_id: str,
    output_dir: Path,
    *,
    workbook_bytes: bytes | None = None,
    workbook_path: Path | None = None,
    version_label: str | None = None,
    progress_callback: Optional[LlmProgressCallback] = None,
) -> Dict[str, Any]:
    """Parse PD spec workbook and enrich all deviations with sequential LLM analysis."""
    index_path = paths.local_protocol_paragraph_index_json(study_id, output_dir)
    acrf_path = paths.local_acrf_summary_text_merged(study_id, output_dir)
    if not index_path.is_file():
        raise ValueError(f"Missing paragraph index: {index_path}")
    if not acrf_path.is_file():
        raise ValueError(f"Missing merged aCRF summary: {acrf_path}")

    if workbook_bytes is None:
        if workbook_path is None or not workbook_path.is_file():
            workbook_path = paths.local_pd_spec_workbook(study_id, output_dir)
        if not workbook_path.is_file():
            raise ValueError("PD specifications workbook not found")
        workbook_bytes = workbook_path.read_bytes()

    import_version = (version_label or "").strip() or _next_import_version(study_id, output_dir)
    raw_deviations = parse_pd_spec_xlsx(workbook_bytes)
    index_obj = read_json(index_path)
    acrf_summary = _acrf_summary_text(study_id, output_dir)
    protocol_paragraphs = _numbered_protocol_text(index_obj)

    enriched_rows: List[Dict[str, Any]] = []
    total_deviations = len(raw_deviations)
    for index, dev in enumerate(raw_deviations):
        enriched_rows.append(
            enrich_imported_deviation(
                study_id=study_id,
                output_dir=output_dir,
                deviation=dev,
                index_obj=index_obj,
                acrf_summary=acrf_summary,
                protocol_paragraphs=protocol_paragraphs,
            )
        )
        if progress_callback and total_deviations > 0:
            progress_callback(
                phase="pd-enrich",
                current=index + 1,
                total=total_deviations,
                unit="deviations",
                label=str(dev.get("deviation_id", "")),
            )

    enriched_rows.sort(key=lambda row: str(row.get("deviation_id", "")))

    snapshot = build_deviations_state(
        study_id=study_id,
        deviations=enriched_rows,
        import_version=import_version,
        source_type="import",
        pd_spec_import_mode="enrich",
    )
    errs = validate(snapshot, load_schema("deviations_parsed_v2.schema.json"))
    if errs:
        raise ValueError("; ".join(errs))

    snapshot_path = paths.local_deviations_import_snapshot(study_id, output_dir, import_version)
    write_json(snapshot_path, snapshot)
    study_artifact_sync.mirror_upload_path(study_id, output_dir, snapshot_path)

    from pdcheck_factory import review_sources

    review_source_key = review_sources.REVIEW_SOURCE_ENRICHED_PD_SPEC
    per_source_path = review_sources.review_state_path(study_id, output_dir, review_source_key)
    write_json(per_source_path, snapshot)
    study_artifact_sync.mirror_upload_path(study_id, output_dir, per_source_path)

    review_path = paths.local_deviations_review_state(study_id, output_dir)
    validated_path = paths.local_deviations_validated_json(study_id, output_dir)
    write_json(review_path, snapshot)
    write_json(validated_path, snapshot)
    study_artifact_sync.mirror_upload_path(study_id, output_dir, review_path)
    study_artifact_sync.mirror_upload_path(study_id, output_dir, validated_path)

    return {
        "import_version": import_version,
        "deviations": enriched_rows,
        "pd_spec_import_mode": "enrich",
        "review_source": review_source_key,
        "snapshot_path": str(snapshot_path),
        "deviation_count": len(enriched_rows),
    }

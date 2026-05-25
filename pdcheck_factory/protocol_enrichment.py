"""Protocol enrichment for imported PD spec deviations (parallel Azure OpenAI tasks)."""

from __future__ import annotations

import json
import os
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Literal, Optional, Set, Tuple, TypeVar

from pydantic import BaseModel, ConfigDict, Field

from pdcheck_factory import import_grounding, llm, paths, study_artifact_sync
from pdcheck_factory.import_grounding import (
    build_deviations_state,
    retrieve_paragraph_candidates,
)
from pdcheck_factory.json_util import load_schema, read_json, validate, write_json
from pdcheck_factory.pd_spec_import import parse_pd_spec_xlsx
from pdcheck_factory.prompt_loader import load_prompt

T = TypeVar("T")

_PARAGRAPH_REF_RE = re.compile(r"^p[0-9]+$")
_LOGIC_CONFIDENCE_THRESHOLD = 0.7
_ACRF_SUMMARY_MAX_CHARS = 50000


class _StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class LogicEnrichmentOutput(_StrictModel):
    improved_deviation_text: str = Field(min_length=1)
    improved_pseudo_logic_plain_english: str = ""
    paragraph_refs: List[str] = Field(default_factory=list)
    data_support_note: str = ""
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    block_auto_text_update: bool = False


class CaveatsEnrichmentOutput(_StrictModel):
    assumptions: List[str] = Field(default_factory=list)
    caveats: List[str] = Field(default_factory=list)
    data_gaps: List[str] = Field(default_factory=list)
    required_datasets: List[str] = Field(default_factory=list)
    required_fields: List[str] = Field(default_factory=list)


class CritiqueEnrichmentOutput(_StrictModel):
    weak_spots: List[str] = Field(default_factory=list)
    suggested_changes: List[str] = Field(default_factory=list)
    protocol_conflicts: List[str] = Field(default_factory=list)
    programmability_risk: Literal["low", "medium", "high"] = "medium"
    block_auto_text_update: bool = False


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _acrf_summary_text(study_id: str, output_dir: Path) -> str:
    summary = read_json(paths.local_acrf_summary_text_merged(study_id, output_dir))
    return json.dumps(summary, ensure_ascii=False, indent=2)


def _next_import_version(study_id: str, output_dir: Path) -> str:
    review_dir = paths.local_review_dir(study_id, output_dir)
    existing = sorted(review_dir.glob("deviations_import_*.json")) if review_dir.exists() else []
    return f"v{len(existing) + 1}"


def _format_paragraph_candidates(candidates: List[Dict[str, Any]]) -> str:
    lines: List[str] = []
    for paragraph in candidates:
        pid = str(paragraph.get("paragraph_id", ""))
        text = str(paragraph.get("text", ""))[:1200]
        lines.append(f"{pid}: {text}")
    return "\n\n".join(lines)


def _filter_refs(refs: List[str], valid: Set[str]) -> List[str]:
    return [r for r in refs if r in valid and _PARAGRAPH_REF_RE.match(r)]


def _enrichment_max_workers() -> int:
    raw = os.getenv("PROTOCOL_ENRICH_MAX_WORKERS", "5").strip()
    try:
        value = int(raw)
    except ValueError:
        value = 5
    return max(1, min(value, 10))


def run_parallel_json_tasks(
    tasks: List[Tuple[str, Callable[[], T]]],
) -> Dict[str, T | Exception]:
    """Run named callables in parallel; return values or captured exceptions."""
    if not tasks:
        return {}
    results: Dict[str, T | Exception] = {}
    with ThreadPoolExecutor(max_workers=len(tasks)) as executor:
        future_by_name = {name: executor.submit(fn) for name, fn in tasks}
        for name, future in future_by_name.items():
            try:
                results[name] = future.result()
            except Exception as exc:  # noqa: BLE001
                results[name] = exc
    return results


def _common_user_fields(
    *,
    study_id: str,
    deviation: Dict[str, Any],
    candidate_text: str,
    acrf_summary: str,
) -> Dict[str, str]:
    return {
        "study_id": study_id,
        "deviation_id": str(deviation.get("deviation_id", "")),
        "protocol_deviation_category": str(deviation.get("protocol_deviation_category", "")),
        "protocol_deviation_sub_category": str(deviation.get("protocol_deviation_sub_category", "")),
        "classification": str(deviation.get("classification", "")),
        "deviation_text": str(deviation.get("text", "")),
        "pseudo_logic_seed": str(deviation.get("pseudo_logic_seed", "") or ""),
        "paragraph_candidates": candidate_text or "(no candidates)",
        "acrf_summary": acrf_summary[:_ACRF_SUMMARY_MAX_CHARS],
    }


def _run_logic_task(
    *,
    study_id: str,
    deviation: Dict[str, Any],
    candidate_text: str,
    acrf_summary: str,
) -> LogicEnrichmentOutput:
    fields = _common_user_fields(
        study_id=study_id,
        deviation=deviation,
        candidate_text=candidate_text,
        acrf_summary=acrf_summary,
    )
    raw = llm.chat_json(
        system=load_prompt("protocol_enrich_logic_system"),
        user=load_prompt("protocol_enrich_logic_user").format(**fields),
        response_model=LogicEnrichmentOutput,
        validator=lambda d: _validate_paragraph_refs_in_logic(d, fields["paragraph_candidates"]),
        max_repairs=2,
    )
    return LogicEnrichmentOutput.model_validate(raw)


def _validate_paragraph_refs_in_logic(data: Dict[str, Any], candidates_block: str) -> List[str]:
    errs: List[str] = []
    valid_ids = set(re.findall(r"\b(p[0-9]+)\b", candidates_block))
    for ref in data.get("paragraph_refs", []):
        if ref not in valid_ids:
            errs.append(f"paragraph_refs contains id not in candidates: {ref}")
    return errs[:10]


def _run_caveats_task(
    *,
    study_id: str,
    deviation: Dict[str, Any],
    candidate_text: str,
    acrf_summary: str,
) -> CaveatsEnrichmentOutput:
    fields = _common_user_fields(
        study_id=study_id,
        deviation=deviation,
        candidate_text=candidate_text,
        acrf_summary=acrf_summary,
    )
    raw = llm.chat_json(
        system=load_prompt("protocol_enrich_caveats_system"),
        user=load_prompt("protocol_enrich_caveats_user").format(**fields),
        response_model=CaveatsEnrichmentOutput,
        validator=lambda _d: [],
        max_repairs=2,
    )
    return CaveatsEnrichmentOutput.model_validate(raw)


def _run_critique_task(
    *,
    study_id: str,
    deviation: Dict[str, Any],
    candidate_text: str,
    acrf_summary: str,
) -> CritiqueEnrichmentOutput:
    fields = _common_user_fields(
        study_id=study_id,
        deviation=deviation,
        candidate_text=candidate_text,
        acrf_summary=acrf_summary,
    )
    raw = llm.chat_json(
        system=load_prompt("protocol_enrich_critique_system"),
        user=load_prompt("protocol_enrich_critique_user").format(**fields),
        response_model=CritiqueEnrichmentOutput,
        validator=lambda _d: [],
        max_repairs=2,
    )
    return CritiqueEnrichmentOutput.model_validate(raw)


def _merge_enrichment_outputs(
    *,
    deviation: Dict[str, Any],
    logic: Optional[LogicEnrichmentOutput],
    caveats: Optional[CaveatsEnrichmentOutput],
    critique: Optional[CritiqueEnrichmentOutput],
    valid_ids: Set[str],
    enrichment_errors: Dict[str, str],
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """Return (merged_sidecar, updated_deviation_row_fields)."""
    original_text = str(deviation.get("text", ""))
    logic_out = logic
    critique_out = critique
    caveats_out = caveats

    paragraph_refs: List[str] = []
    data_support_note = str(deviation.get("data_support_note", "") or "")
    improved_text = original_text
    pseudo_seed = str(deviation.get("pseudo_logic_seed", "") or "")

    block_update = False
    if critique_out and critique_out.block_auto_text_update:
        block_update = True
    if logic_out and logic_out.block_auto_text_update:
        block_update = True

    if logic_out:
        paragraph_refs = _filter_refs(list(logic_out.paragraph_refs), valid_ids)
        if logic_out.data_support_note.strip():
            data_support_note = logic_out.data_support_note.strip()
        if logic_out.improved_pseudo_logic_plain_english.strip():
            pseudo_seed = logic_out.improved_pseudo_logic_plain_english.strip()
        if (
            not block_update
            and logic_out.confidence >= _LOGIC_CONFIDENCE_THRESHOLD
            and logic_out.improved_deviation_text.strip()
        ):
            improved_text = logic_out.improved_deviation_text.strip()

    programmability_risk = critique_out.programmability_risk if critique_out else "medium"
    protocol_conflicts = list(critique_out.protocol_conflicts) if critique_out else []
    weak_spots = list(critique_out.weak_spots) if critique_out else []
    suggested_changes = list(critique_out.suggested_changes) if critique_out else []

    assumptions = list(caveats_out.assumptions) if caveats_out else []
    caveat_list = list(caveats_out.caveats) if caveats_out else []
    data_gaps = list(caveats_out.data_gaps) if caveats_out else []
    required_datasets = list(caveats_out.required_datasets) if caveats_out else []
    required_fields = list(caveats_out.required_fields) if caveats_out else []

    status = str(deviation.get("status") or "pending")
    if enrichment_errors:
        enrichment_status = (
            "partial" if (logic_out or caveats_out or critique_out) else "failed"
        )
    elif not logic_out or not caveats_out or not critique_out:
        enrichment_status = "partial"
    else:
        enrichment_status = "ok"

    needs_review = (
        programmability_risk == "high"
        or bool(protocol_conflicts)
        or bool(enrichment_errors)
        or not paragraph_refs
        or block_update
    )
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
        summary_parts.append(f"Task errors: {', '.join(enrichment_errors.keys())}")
    enrichment_summary = "; ".join(summary_parts) if summary_parts else "Enrichment complete"

    merged = {
        "improved_deviation_text": improved_text,
        "improved_pseudo_logic_plain_english": pseudo_seed,
        "paragraph_refs": paragraph_refs,
        "data_support_note": data_support_note,
        "assumptions": assumptions,
        "caveats": caveat_list,
        "data_gaps": data_gaps,
        "required_datasets": required_datasets,
        "required_fields": required_fields,
        "weak_spots": weak_spots,
        "suggested_changes": suggested_changes,
        "protocol_conflicts": protocol_conflicts,
        "programmability_risk": programmability_risk,
    }

    row_updates = {
        "text": improved_text,
        "paragraph_refs": paragraph_refs,
        "data_support_note": data_support_note,
        "pseudo_logic_seed": pseudo_seed,
        "status": status,
        "enrichment_status": enrichment_status,
        "enrichment_summary": enrichment_summary,
        "entry_source": "imported_pd_spec",
    }
    return merged, row_updates


def enrich_imported_deviation(
    *,
    study_id: str,
    output_dir: Path,
    deviation: Dict[str, Any],
    index_obj: Dict[str, Any],
    acrf_summary: str,
) -> Dict[str, Any]:
    """Run three parallel enrichment LLM tasks for one deviation."""
    valid_ids = {str(p.get("paragraph_id", "")) for p in index_obj.get("paragraphs", [])}
    candidates = retrieve_paragraph_candidates(deviation=deviation, index_obj=index_obj)
    candidate_text = _format_paragraph_candidates(candidates)

    parallel = run_parallel_json_tasks(
        [
            (
                "logic",
                lambda: _run_logic_task(
                    study_id=study_id,
                    deviation=deviation,
                    candidate_text=candidate_text,
                    acrf_summary=acrf_summary,
                ),
            ),
            (
                "caveats",
                lambda: _run_caveats_task(
                    study_id=study_id,
                    deviation=deviation,
                    candidate_text=candidate_text,
                    acrf_summary=acrf_summary,
                ),
            ),
            (
                "critique",
                lambda: _run_critique_task(
                    study_id=study_id,
                    deviation=deviation,
                    candidate_text=candidate_text,
                    acrf_summary=acrf_summary,
                ),
            ),
        ]
    )

    enrichment_errors: Dict[str, str] = {}
    logic: Optional[LogicEnrichmentOutput] = None
    caveats: Optional[CaveatsEnrichmentOutput] = None
    critique: Optional[CritiqueEnrichmentOutput] = None

    for task_name, result in parallel.items():
        if isinstance(result, Exception):
            enrichment_errors[task_name] = str(result)
            continue
        if task_name == "logic":
            logic = result
        elif task_name == "caveats":
            caveats = result
        elif task_name == "critique":
            critique = result

    merged, row_updates = _merge_enrichment_outputs(
        deviation=deviation,
        logic=logic,
        caveats=caveats,
        critique=critique,
        valid_ids=valid_ids,
        enrichment_errors=enrichment_errors,
    )

    if enrichment_errors and not (logic or caveats or critique):
        row_updates["enrichment_status"] = "failed"

    artifact: Dict[str, Any] = {
        "schema_version": "1.0.0",
        "study_id": study_id,
        "deviation_id": str(deviation.get("deviation_id", "")),
        "generated_at": _iso_now(),
        "enrichment_status": row_updates.get("enrichment_status", "ok"),
        "enrichment_summary": row_updates.get("enrichment_summary", ""),
        "enrichment_errors": enrichment_errors,
        "logic": logic.model_dump(mode="json") if logic else None,
        "caveats": caveats.model_dump(mode="json") if caveats else None,
        "critique": critique.model_dump(mode="json") if critique else None,
        "merged": merged,
    }

    artifact_path = paths.local_protocol_enrichment_json(
        study_id, output_dir, str(deviation.get("deviation_id", ""))
    )
    artifact_path.parent.mkdir(parents=True, exist_ok=True)
    write_json(artifact_path, artifact)
    study_artifact_sync.mirror_upload_path(study_id, output_dir, artifact_path)

    updated = dict(deviation)
    updated.update(row_updates)
    return updated


def run_protocol_enrichment(
    study_id: str,
    output_dir: Path,
    *,
    workbook_bytes: bytes | None = None,
    workbook_path: Path | None = None,
    version_label: str | None = None,
) -> Dict[str, Any]:
    """Parse PD spec workbook and enrich all deviations with parallel LLM analysis."""
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

    enriched_rows: List[Dict[str, Any]] = []
    max_workers = _enrichment_max_workers()

    def _process_one(dev: Dict[str, Any]) -> Dict[str, Any]:
        return enrich_imported_deviation(
            study_id=study_id,
            output_dir=output_dir,
            deviation=dev,
            index_obj=index_obj,
            acrf_summary=acrf_summary,
        )

    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {pool.submit(_process_one, dev): dev for dev in raw_deviations}
        for future in as_completed(futures):
            enriched_rows.append(future.result())

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

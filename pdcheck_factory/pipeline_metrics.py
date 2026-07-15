"""Aggregate per-run pipeline quality metrics."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Mapping

from pdcheck_factory.check_validate import count_valid_citations, validate_check_artifacts


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _pct(numerator: int, denominator: int) -> float:
    if denominator <= 0:
        return 0.0
    return round(100.0 * numerator / denominator, 2)


def build_pipeline_metrics(
    *,
    study_id: str,
    deviations_obj: Mapping[str, Any],
    rules_obj: Mapping[str, Any] | None = None,
    pseudo_obj: Mapping[str, Any] | None = None,
    dictionary_obj: Mapping[str, Any] | None = None,
    dedup_audit: Mapping[str, Any] | None = None,
    programmability_obj: Mapping[str, Any] | None = None,
    final_obj: Mapping[str, Any] | None = None,
    paragraph_index: Mapping[str, Any] | None = None,
) -> Dict[str, Any]:
    validation = validate_check_artifacts(
        deviations_obj=deviations_obj,
        rules_obj=rules_obj,
        pseudo_obj=pseudo_obj,
        dictionary_obj=dictionary_obj,
        final_obj=final_obj,
        paragraph_index=paragraph_index,
    )

    pseudo_items = list((pseudo_obj or {}).get("items", []))
    total_field_refs = 0
    valid_field_refs = 0
    needs_mapping_review_count = 0
    for item in pseudo_items:
        field_validation = item.get("field_validation", {})
        valid_fields = list(field_validation.get("valid_fields", []))
        invalid_fields = list(field_validation.get("invalid_fields", []))
        total_field_refs += len(valid_fields) + len(invalid_fields)
        valid_field_refs += len(valid_fields)
        if item.get("status") == "needs_mapping_review" or field_validation.get("needs_mapping_review"):
            needs_mapping_review_count += 1

    programmability_counts = {"programmable": 0, "partially_programmable": 0, "manual": 0}
    for item in (programmability_obj or {}).get("items", []):
        key = str(item.get("programmability", "")).strip().lower()
        if key in programmability_counts:
            programmability_counts[key] += 1
    classified_total = sum(programmability_counts.values()) or 1

    duplicates_removed = int((dedup_audit or {}).get("duplicates_removed", 0))

    return {
        "schema_version": "1.0.0",
        "study_id": study_id,
        "generated_at": _iso_now(),
        "metrics": {
            "pct_fields_in_acrf_dictionary": _pct(valid_field_refs, total_field_refs),
            "duplicates_removed": duplicates_removed,
            "pct_programmable": _pct(programmability_counts["programmable"], classified_total),
            "pct_partially_programmable": _pct(
                programmability_counts["partially_programmable"], classified_total
            ),
            "pct_manual": _pct(programmability_counts["manual"], classified_total),
            "needs_mapping_review_count": needs_mapping_review_count,
            "valid_citation_count": count_valid_citations(deviations_obj),
            "validation_failure_count": len(validation.errors),
            "validation_warning_count": len(validation.warnings),
        },
        "validation": validation.to_dict(),
    }

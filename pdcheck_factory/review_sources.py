"""Review step data sources (generated vs PD spec import vs enrich)."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Set

from pdcheck_factory import paths

REVIEW_SOURCE_GENERATED = "generated"
REVIEW_SOURCE_IMPORTED_PD_SPEC = "imported_pd_spec"
REVIEW_SOURCE_ENRICHED_PD_SPEC = "enriched_pd_spec"

VALID_REVIEW_SOURCES: Set[str] = {
    REVIEW_SOURCE_GENERATED,
    REVIEW_SOURCE_IMPORTED_PD_SPEC,
    REVIEW_SOURCE_ENRICHED_PD_SPEC,
}

REVIEW_SOURCE_LABELS: Dict[str, str] = {
    REVIEW_SOURCE_GENERATED: "Generated deviations",
    REVIEW_SOURCE_IMPORTED_PD_SPEC: "Imported PD Specifications",
    REVIEW_SOURCE_ENRICHED_PD_SPEC: "Enriched PD Specifications",
}


def normalize_review_source(value: str | None) -> str:
    key = str(value or "").strip()
    if key not in VALID_REVIEW_SOURCES:
        raise ValueError(f"Invalid reviewSource '{key}'")
    return key


def review_state_path(study_id: str, output_dir: Path, review_source: str) -> Path:
    key = normalize_review_source(review_source)
    if key == REVIEW_SOURCE_GENERATED:
        return paths.local_deviations_review_generated_json(study_id, output_dir)
    if key == REVIEW_SOURCE_IMPORTED_PD_SPEC:
        return paths.local_deviations_review_imported_pd_spec_json(study_id, output_dir)
    return paths.local_deviations_review_enriched_pd_spec_json(study_id, output_dir)


def empty_review_state(study_id: str) -> Dict[str, Any]:
    from datetime import datetime, timezone

    return {
        "schema_version": "1.0.0",
        "study_id": study_id,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "deviations": [],
    }

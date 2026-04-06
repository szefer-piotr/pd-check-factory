"""Merge PD candidates + logic drafts; validate against pd_draft_spec.schema.json."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Tuple

from pdcheck_factory.json_util import load_schema, read_json, validate, write_json

SCHEMA_VERSION = "1.0.0"


def merge_records(
    study_id: str,
    candidates: List[Dict[str, Any]],
    logic_drafts: List[Dict[str, Any]],
) -> Tuple[Dict[str, Any], List[str]]:
    logic_by_candidate = {l["candidate_id"]: l for l in logic_drafts}
    specs: List[Dict[str, Any]] = []
    missing_logic: List[str] = []

    for idx, c in enumerate(candidates, start=1):
        cid = c["candidate_id"]
        logic = logic_by_candidate.get(cid)
        if logic is None:
            missing_logic.append(cid)
            continue

        chunk_ids = sorted(
            {
                ev.get("chunk_id", "")
                for ev in c.get("source_evidence", [])
                if ev.get("chunk_id")
            }
        )
        spec = {
            "spec_id": f"pd:{idx:05d}",
            "study_id": study_id,
            "schema_version": SCHEMA_VERSION,
            "status": "draft",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "chunk_ids": chunk_ids or ["unknown_chunk"],
            "deviation_title": c["deviation_title"],
            "deviation_category": c["deviation_category"],
            "protocol_rule_description": c["protocol_rule_description"],
            "candidate_trigger_condition": c["candidate_trigger_condition"],
            "required_source_data_domain_hints": logic["required_source_data_domain_hints"],
            "timing_anchor": c["timing_anchor"],
            "allowed_window": c["allowed_window"],
            "exceptions_notes": c.get("exceptions_notes", ""),
            "source_evidence": c["source_evidence"],
            "confidence": max(
                0.0,
                min(
                    1.0,
                    float(
                        (c.get("confidence", 0.0) + logic.get("confidence", 0.0)) / 2
                    ),
                ),
            ),
            "ambiguity_flag": bool(
                c.get("ambiguity_flag", False) or logic.get("ambiguity_flag", False)
            ),
            "reviewer_notes": c.get("reviewer_notes", "")
            or logic.get("reviewer_notes", ""),
        }
        specs.append(spec)

    out = {
        "schema_version": SCHEMA_VERSION,
        "study_id": study_id,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "pd_draft_specs": specs,
    }
    return out, missing_logic


def merge_and_validate_files(
    *,
    study_id: str,
    candidates_path: Path,
    logic_path: Path,
    output_path: Path,
) -> Path:
    candidates_data = read_json(candidates_path)
    logic_data = read_json(logic_path)
    schema = load_schema("pd_draft_spec.schema.json")

    merged, missing = merge_records(
        study_id,
        candidates_data.get("candidates", []),
        logic_data.get("logic_drafts", []),
    )

    errors = validate(merged, schema)
    if errors:
        raise ValueError("Schema validation failed: " + "; ".join(errors[:15]))
    if missing:
        raise ValueError(
            "Missing logic drafts for candidates: " + ", ".join(missing[:20])
        )

    write_json(output_path, merged)
    return output_path

"""Generate pseudo-logic narrative bundle from PD draft specs (post-review)."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

from pdcheck_factory.json_util import read_json, write_json


def emit_pseudo_bundle(
    *,
    pd_specs_path: Path,
    output_path: Path,
    study_id: str,
) -> Path:
    data = read_json(pd_specs_path)
    specs: List[Dict[str, Any]] = data.get("pd_draft_specs", [])
    entries = []
    for spec in specs:
        hints = spec.get("required_source_data_domain_hints") or []
        chunk_ids = spec.get("chunk_ids") or []
        entries.append(
            {
                "spec_id": spec.get("spec_id", ""),
                "status": spec.get("status", "draft"),
                "deviation_title": spec.get("deviation_title", ""),
                "narrative_check_steps": [
                    f"Verify rule context: {spec.get('protocol_rule_description', '')[:500]}",
                    f"If triggered: {spec.get('candidate_trigger_condition', '')[:500]}",
                ],
                "data_elements": list(hints),
                "evidence_chunk_ids": list(chunk_ids),
                "edge_cases": [
                    spec.get("exceptions_notes", "") or "None recorded in draft.",
                ],
            }
        )

    bundle = {
        "schema_version": "1.0.0",
        "study_id": study_id,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "entries": entries,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    write_json(output_path, bundle)

    md_path = output_path.with_suffix(".md")
    lines = [f"# Pseudo logic bundle — {study_id}", ""]
    for e in entries:
        lines.append(f"## {e['spec_id']}: {e['deviation_title']}")
        lines.append("")
        for s in e.get("narrative_check_steps", []):
            lines.append(f"- {s}")
        lines.append("")
        lines.append("**Data domains:** " + ", ".join(e.get("data_elements", [])))
        lines.append("")
    md_path.write_text("\n".join(lines), encoding="utf-8")

    return output_path

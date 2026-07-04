"""Build model-output log separate from final PD specification export."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Mapping

from pdcheck_factory.deviation_contract import pd_spec_field


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_model_output_log(
    *,
    study_id: str,
    deviations: List[Mapping[str, Any]],
    rules_by_id: Mapping[str, Mapping[str, Any]],
    pseudo_by_dev: Mapping[str, Mapping[str, Any]],
    classification_audit: List[Mapping[str, Any]] | None = None,
    consolidation_audit: List[Mapping[str, Any]] | None = None,
) -> Dict[str, Any]:
    entries: List[Dict[str, Any]] = []
    class_by_dev = {
        str(row.get("deviation_id", "")): row for row in (classification_audit or [])
    }
    for dev in deviations:
        dev_id = str(dev.get("deviation_id", ""))
        rule = rules_by_id.get(str(dev.get("rule_id", "")), {})
        pseudo = pseudo_by_dev.get(dev_id, {})
        class_row = class_by_dev.get(dev_id, {})
        entries.append(
            {
                "deviation_id": dev_id,
                "rule_id": str(dev.get("rule_id", "")),
                "rule_title": str(rule.get("title", "")),
                "rule_text": str(rule.get("text", "")),
                "deviation_text": str(dev.get("text", "")),
                "paragraph_refs": list(dev.get("paragraph_refs", [])),
                "data_support_note": str(dev.get("data_support_note", "")),
                "protocol_deviation_category": pd_spec_field(dev, "protocol_deviation_category"),
                "protocol_deviation_sub_category": pd_spec_field(dev, "protocol_deviation_sub_category"),
                "classification_confidence": str(class_row.get("confidence", "")),
                "classification_rationale": str(class_row.get("rationale", "")),
                "programmability_note": str(pseudo.get("programmability_note", "")),
                "pseudo_logic": str(pseudo.get("pseudo_logic", "")),
                "review_status": str(dev.get("status", "")),
                "dm_comment": str(dev.get("dm_comment", "")),
            }
        )
    return {
        "schema_version": "1.0.0",
        "study_id": study_id,
        "generated_at": _iso_now(),
        "entries": entries,
        "consolidation_audit": list(consolidation_audit or []),
    }

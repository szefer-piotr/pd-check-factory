"""Classify deviations against the official PD category taxonomy."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from pdcheck_factory import llm, text_parse
from pdcheck_factory.pd_taxonomy import normalize_category_pair, taxonomy_prompt_text
from pdcheck_factory.prompt_loader import load_prompt

BEGIN_CLASSIFY = "<<<BEGIN_CLASSIFY>>>"
END_CLASSIFY = "<<<END_CLASSIFY>>>"


def parse_category_classify_blocks(text: str) -> List[Dict[str, Any]]:
    blocks = text_parse._extract_blocks(text or "", BEGIN_CLASSIFY, END_CLASSIFY)
    out: List[Dict[str, Any]] = []
    for raw in blocks:
        deviation_id = ""
        category = ""
        sub_category = ""
        confidence = ""
        rationale = ""
        for line in raw.splitlines():
            stripped = line.strip()
            if stripped.startswith("DEVIATION_ID:"):
                deviation_id = stripped[len("DEVIATION_ID:") :].strip()
            elif stripped.startswith("CATEGORY:"):
                category = stripped[len("CATEGORY:") :].strip()
            elif stripped.startswith("SUB_CATEGORY:"):
                sub_category = stripped[len("SUB_CATEGORY:") :].strip()
            elif stripped.startswith("CONFIDENCE:"):
                confidence = stripped[len("CONFIDENCE:") :].strip().lower()
            elif stripped.startswith("RATIONALE:"):
                rationale = stripped[len("RATIONALE:") :].strip()
        if deviation_id:
            out.append(
                {
                    "deviation_id": deviation_id,
                    "category": category,
                    "sub_category": sub_category,
                    "confidence": confidence,
                    "rationale": rationale,
                }
            )
    return out


def _validate_classify_reply(text: str) -> Optional[str]:
    if BEGIN_CLASSIFY not in text:
        return "Must contain classification blocks."
    if not parse_category_classify_blocks(text):
        return "Classification blocks must include DEVIATION_ID."
    return None


def classify_deviation(
    *,
    study_id: str,
    rule: Dict[str, Any],
    deviation: Dict[str, Any],
) -> Dict[str, Any]:
    system = load_prompt("category_classify_v2_system").format(taxonomy=taxonomy_prompt_text())
    user = load_prompt("category_classify_v2_user").format(
        study_id=study_id,
        rule_id=rule.get("rule_id", ""),
        rule_title=rule.get("title", ""),
        rule_text=rule.get("text", ""),
        deviation_id=deviation.get("deviation_id", ""),
        deviation_text=deviation.get("text", ""),
        paragraph_refs=", ".join(deviation.get("paragraph_refs", [])),
    )
    reply = llm.chat_text_repairs(
        system=system,
        user=user,
        validate_reply=_validate_classify_reply,
        max_repairs=1,
        label=f"v2-classify-{deviation.get('deviation_id', '')}",
    )
    parsed = parse_category_classify_blocks(reply)
    row = parsed[0] if parsed else {}
    confidence = str(row.get("confidence", "")).strip().lower()
    category, sub_category = normalize_category_pair(
        str(row.get("category", "")),
        str(row.get("sub_category", "")),
    )
    if confidence not in {"high", "medium"}:
        category, sub_category = "", ""
    return {
        "deviation_id": deviation.get("deviation_id", ""),
        "protocol_deviation_category": category,
        "protocol_deviation_sub_category": sub_category,
        "confidence": confidence,
        "rationale": str(row.get("rationale", "")),
    }


def classify_deviations(
    *,
    study_id: str,
    deviations: List[Dict[str, Any]],
    rules_by_id: Dict[str, Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    audit: List[Dict[str, Any]] = []
    for deviation in deviations:
        rule = rules_by_id.get(str(deviation.get("rule_id", "")), {})
        result = classify_deviation(study_id=study_id, rule=rule, deviation=deviation)
        audit.append(result)
        pd_import = dict(deviation.get("pd_spec_import") or {})
        pd_import["protocol_deviation_category"] = result["protocol_deviation_category"]
        pd_import["protocol_deviation_sub_category"] = result["protocol_deviation_sub_category"]
        deviation["pd_spec_import"] = pd_import
    return deviations, audit

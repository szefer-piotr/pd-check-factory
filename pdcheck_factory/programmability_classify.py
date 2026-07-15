"""Classify deviation programmability as a separate pipeline step."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Mapping, Optional

from pdcheck_factory import llm
from pdcheck_factory.acrf_field_dictionary import compact_dictionary_for_prompt, lookup_field
from pdcheck_factory.prompt_loader import load_prompt

BEGIN_PROGRAMMABILITY = "<<<BEGIN_PROGRAMMABILITY>>>"
END_PROGRAMMABILITY = "<<<END_PROGRAMMABILITY>>>"
_SUBJECTIVE_RE = re.compile(
    r"\b(investigator|clinical judgement|clinical judgment|per pi|physician judgement|subjective|narrative)\b",
    re.I,
)

_PROGRAMMABILITY_MAP = {
    "programmable": "Programmable",
    "partially_programmable": "Partially programmable",
    "manual": "Manual",
}


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_programmability_classify_block(text: str) -> Dict[str, Any]:
    out: Dict[str, Any] = {
        "programmability": "",
        "reason": "",
        "required_data": [],
        "available_data": [],
        "missing_data": [],
    }
    for line in (text or "").splitlines():
        stripped = line.strip()
        if stripped.startswith("PROGRAMMABILITY:"):
            out["programmability"] = stripped[len("PROGRAMMABILITY:") :].strip().lower()
        elif stripped.startswith("REASON:"):
            out["reason"] = stripped[len("REASON:") :].strip()
        elif stripped.startswith("REQUIRED_DATA:"):
            out["required_data"] = _split_refs(stripped[len("REQUIRED_DATA:") :])
        elif stripped.startswith("AVAILABLE_DATA:"):
            out["available_data"] = _split_refs(stripped[len("AVAILABLE_DATA:") :])
        elif stripped.startswith("MISSING_DATA:"):
            out["missing_data"] = _split_refs(stripped[len("MISSING_DATA:") :])
    return out


def _split_refs(value: str) -> List[str]:
    return [part.strip() for part in (value or "").split(",") if part.strip()]


def _validate_classify_reply(text: str) -> Optional[str]:
    if BEGIN_PROGRAMMABILITY not in text:
        return "Must contain programmability classification block."
    body = text.split(BEGIN_PROGRAMMABILITY, 1)[1].split(END_PROGRAMMABILITY, 1)[0]
    parsed = parse_programmability_classify_block(body)
    if parsed.get("programmability") not in _PROGRAMMABILITY_MAP:
        return "PROGRAMMABILITY must be programmable, partially_programmable, or manual."
    return None


def _field_known(dictionary_obj: Mapping[str, Any], ref: str) -> bool:
    ref = ref.strip()
    if not ref:
        return True
    if "." in ref:
        dataset_name, column_name = ref.split(".", 1)
        return lookup_field(dict(dictionary_obj), dataset_name, column_name) is not None
    return lookup_field(dict(dictionary_obj), "", ref) is not None


def apply_deterministic_overrides(
    *,
    classification: Dict[str, Any],
    deviation_text: str,
    dictionary_obj: Mapping[str, Any],
) -> Dict[str, Any]:
    out = dict(classification)
    programmability = str(out.get("programmability", "")).strip().lower()
    missing_data = list(out.get("missing_data", []))
    required_data = list(out.get("required_data", []))

    if _SUBJECTIVE_RE.search(deviation_text):
        out["programmability"] = "manual"
        out["reason"] = f"{out.get('reason', '')} Subjective clinical judgement required.".strip()
        programmability = "manual"

    unknown_required = [ref for ref in required_data if not _field_known(dictionary_obj, ref)]
    unknown_missing = [ref for ref in missing_data if ref and not _field_known(dictionary_obj, ref)]
    if unknown_required or unknown_missing:
        if programmability == "programmable":
            out["programmability"] = "partially_programmable"
            out["reason"] = (
                f"{out.get('reason', '')} Required fields not fully validated in ACRF dictionary."
            ).strip()
        elif programmability != "manual":
            out["programmability"] = "manual"
            out["reason"] = (
                f"{out.get('reason', '')} Missing or unknown structured data."
            ).strip()

    if missing_data and programmability == "programmable":
        out["programmability"] = "partially_programmable"
        out["reason"] = f"{out.get('reason', '')} Missing data elements remain.".strip()

    out["manual_or_programmable"] = _PROGRAMMABILITY_MAP.get(
        str(out.get("programmability", "")).strip().lower(), "Manual"
    )
    return out


def classify_single_deviation(
    *,
    study_id: str,
    deviation: Dict[str, Any],
    dictionary_obj: Mapping[str, Any],
) -> Dict[str, Any]:
    system = load_prompt("programmability_classify_v2_system")
    user = load_prompt("programmability_classify_v2_user").format(
        study_id=study_id,
        deviation_id=deviation.get("deviation_id", ""),
        rule_id=deviation.get("rule_id", ""),
        deviation_text=deviation.get("text", ""),
        data_support_note=deviation.get("data_support_note", ""),
        acrf_field_dictionary=compact_dictionary_for_prompt(dict(dictionary_obj)),
    )
    reply = llm.chat_text_repairs(
        system=system,
        user=user,
        validate_reply=_validate_classify_reply,
        max_repairs=1,
        label=f"v2-programmability-classify-{deviation.get('deviation_id', '')}",
    )
    body = reply.split(BEGIN_PROGRAMMABILITY, 1)[1].split(END_PROGRAMMABILITY, 1)[0]
    parsed = parse_programmability_classify_block(body)
    parsed = apply_deterministic_overrides(
        classification=parsed,
        deviation_text=str(deviation.get("text", "")),
        dictionary_obj=dictionary_obj,
    )
    return {
        "deviation_id": deviation.get("deviation_id", ""),
        "rule_id": deviation.get("rule_id", ""),
        "programmability": parsed.get("programmability", "manual"),
        "reason": parsed.get("reason", ""),
        "required_data": parsed.get("required_data", []),
        "available_data": parsed.get("available_data", []),
        "missing_data": parsed.get("missing_data", []),
        "manual_or_programmable": parsed.get("manual_or_programmable", "Manual"),
    }


def classify_deviation_programmability(
    *,
    study_id: str,
    deviations: List[Dict[str, Any]],
    dictionary_obj: Mapping[str, Any],
    progress_callback=None,
) -> Dict[str, Any]:
    items: List[Dict[str, Any]] = []
    total = len(deviations)
    for index, deviation in enumerate(deviations):
        items.append(
            classify_single_deviation(
                study_id=study_id,
                deviation=deviation,
                dictionary_obj=dictionary_obj,
            )
        )
        if progress_callback and total > 0:
            progress_callback(
                phase="classify-programmability",
                current=index + 1,
                total=total,
                unit="deviations",
                label=str(deviation.get("deviation_id", "")),
            )
    return {
        "schema_version": "1.0.0",
        "study_id": study_id,
        "generated_at": _iso_now(),
        "items": items,
    }


def programmability_by_deviation_id(classified_obj: Mapping[str, Any]) -> Dict[str, Dict[str, Any]]:
    return {
        str(item.get("deviation_id", "")): dict(item)
        for item in classified_obj.get("items", [])
    }

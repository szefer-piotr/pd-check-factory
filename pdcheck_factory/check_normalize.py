"""Normalize deviation candidates into a standard deduplication schema."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from pdcheck_factory import llm
from pdcheck_factory.prompt_loader import load_prompt

BEGIN_NORMALIZE = "<<<BEGIN_NORMALIZE>>>"
END_NORMALIZE = "<<<END_NORMALIZE>>>"
_WINDOW_RE = re.compile(r"([±+\-]?\s*\d+\s*(?:days?|weeks?|hours?))", re.I)


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_normalize_block(text: str) -> Dict[str, str]:
    out = {
        "subject": "",
        "event": "",
        "procedure": "",
        "condition": "",
        "window": "",
    }
    for line in (text or "").splitlines():
        stripped = line.strip()
        for key in out:
            prefix = f"{key.upper()}:"
            if stripped.startswith(prefix):
                out[key] = stripped[len(prefix) :].strip()
    return out


def _validate_normalize_reply(text: str) -> Optional[str]:
    if BEGIN_NORMALIZE not in text:
        return "Must contain normalization block."
    body = text.split(BEGIN_NORMALIZE, 1)[1].split(END_NORMALIZE, 1)[0]
    parsed = parse_normalize_block(body)
    if not parsed.get("condition"):
        return "Normalization block must include CONDITION."
    return None


def _heuristic_normalize(deviation: Dict[str, Any]) -> Dict[str, str]:
    text = str(deviation.get("text", ""))
    window_match = _WINDOW_RE.search(text)
    return {
        "subject": "visit" if re.search(r"\bvisit\b", text, re.I) else "participant",
        "event": "",
        "procedure": "",
        "condition": text[:250],
        "window": window_match.group(1).strip() if window_match else "",
    }


def normalize_deviation(
    *,
    study_id: str,
    deviation: Dict[str, Any],
) -> Dict[str, str]:
    system = load_prompt("check_normalize_v2_system")
    user = load_prompt("check_normalize_v2_user").format(
        study_id=study_id,
        deviation_id=deviation.get("deviation_id", ""),
        rule_id=deviation.get("rule_id", ""),
        deviation_text=deviation.get("text", ""),
        paragraph_refs=", ".join(deviation.get("paragraph_refs", [])),
    )
    try:
        reply = llm.chat_text_repairs(
            system=system,
            user=user,
            validate_reply=_validate_normalize_reply,
            max_repairs=1,
            label=f"v2-normalize-{deviation.get('deviation_id', '')}",
        )
        body = reply.split(BEGIN_NORMALIZE, 1)[1].split(END_NORMALIZE, 1)[0]
        parsed = parse_normalize_block(body)
    except Exception:
        parsed = _heuristic_normalize(deviation)
    if not parsed.get("condition"):
        parsed = _heuristic_normalize(deviation)
    return parsed


def normalize_deviations(
    *,
    study_id: str,
    deviations: List[Dict[str, Any]],
    progress_callback=None,
) -> Dict[str, Any]:
    items: List[Dict[str, Any]] = []
    total = len(deviations)
    for index, deviation in enumerate(deviations):
        normalized = normalize_deviation(study_id=study_id, deviation=deviation)
        items.append(
            {
                "deviation_id": deviation.get("deviation_id", ""),
                "rule_id": deviation.get("rule_id", ""),
                "subject": normalized.get("subject", ""),
                "event": normalized.get("event", ""),
                "procedure": normalized.get("procedure", ""),
                "condition": normalized.get("condition", ""),
                "window": normalized.get("window", ""),
                "paragraph_refs": list(deviation.get("paragraph_refs", [])),
            }
        )
        if progress_callback and total > 0:
            progress_callback(
                phase="normalize-checks",
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


def dedup_key_from_normalized(item: Dict[str, Any], *, check_type: str = "") -> str:
    parts = [
        check_type.strip().lower(),
        str(item.get("event", "")).strip().lower(),
        str(item.get("procedure", "")).strip().lower(),
        str(item.get("condition", "")).strip().lower(),
        str(item.get("window", "")).strip().lower(),
    ]
    return "|".join(parts)

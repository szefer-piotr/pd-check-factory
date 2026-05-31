"""Canonical deviation fields shared by extraction and enriched PD spec review rows."""

from __future__ import annotations

import re
from typing import Any, Dict, List, Mapping, MutableMapping, Set, Tuple

_PARAGRAPH_REF_RE = re.compile(r"^p[0-9]+$")

CANONICAL_DEVIATION_KEYS = (
    "deviation_id",
    "rule_id",
    "text",
    "paragraph_refs",
    "data_support_note",
    "status",
    "dm_comment",
)

ENRICHED_REVIEW_KEYS = ("original_deviation_text", "suggested_deviation_text")

PD_SPEC_IMPORT_KEYS = (
    "entry_source",
    "protocol_deviation_category",
    "protocol_deviation_sub_category",
    "classification",
    "data_source",
    "manual_or_programmable",
    "programming_status",
    "programmer_comments",
    "reviewer_comments",
    "aa_comment",
    "grounding_error",
    "occurrence_date",
    "additional_information",
    "pseudo_logic_seed",
    "enrichment_status",
    "enrichment_summary",
)

_IMMUTABLE_ENRICHED_KEYS = frozenset(ENRICHED_REVIEW_KEYS)


def filter_paragraph_refs(refs: List[str], valid: Set[str]) -> List[str]:
    return [r for r in refs if r in valid and _PARAGRAPH_REF_RE.match(r)]


def pd_spec_import_from_row(row: Mapping[str, Any]) -> Dict[str, Any]:
    """Build pd_spec_import dict from nested object or legacy flat fields."""
    nested = row.get("pd_spec_import")
    if isinstance(nested, dict):
        source: Mapping[str, Any] = nested
    else:
        source = row
    out: Dict[str, Any] = {}
    for key in PD_SPEC_IMPORT_KEYS:
        value = source.get(key, "")
        if key in ("enrichment_status", "enrichment_summary") and not str(value or "").strip():
            continue
        out[key] = value
    if isinstance(nested, dict):
        for key, value in nested.items():
            if key not in out:
                out[key] = value
    return out


def pd_spec_field(row: Mapping[str, Any], key: str, default: str = "") -> str:
    nested = row.get("pd_spec_import")
    if isinstance(nested, dict) and key in nested:
        return str(nested.get(key, default) or default)
    return str(row.get(key, default) or default)


def has_flat_pd_spec_fields(row: Mapping[str, Any]) -> bool:
    if isinstance(row.get("pd_spec_import"), dict):
        return False
    return any(key in row for key in PD_SPEC_IMPORT_KEYS)


def split_pd_spec_row(row: Mapping[str, Any]) -> Dict[str, Any]:
    """Normalize a deviation row to canonical top-level + nested pd_spec_import."""
    canonical: Dict[str, Any] = {
        key: row.get(key) for key in CANONICAL_DEVIATION_KEYS if key in row
    }
    if "deviation_id" not in canonical:
        canonical["deviation_id"] = str(row.get("deviation_id", ""))
    if "rule_id" not in canonical:
        canonical["rule_id"] = str(row.get("rule_id", ""))
    if "text" not in canonical:
        canonical["text"] = str(row.get("text", ""))
    if "paragraph_refs" not in canonical:
        canonical["paragraph_refs"] = list(row.get("paragraph_refs") or [])
    if "data_support_note" not in canonical:
        canonical["data_support_note"] = str(row.get("data_support_note", "") or "")
    if "status" not in canonical:
        canonical["status"] = str(row.get("status", "pending") or "pending")
    if "dm_comment" not in canonical:
        canonical["dm_comment"] = str(row.get("dm_comment", "") or "")

    for key in ENRICHED_REVIEW_KEYS:
        if key in row:
            canonical[key] = row[key]

    pd_import = pd_spec_import_from_row(row)
    canonical["pd_spec_import"] = pd_import
    return canonical


def lift_pd_spec_row(row: MutableMapping[str, Any]) -> MutableMapping[str, Any]:
    """In-place lift of flat PD spec fields into pd_spec_import."""
    if not has_flat_pd_spec_fields(row):
        if "pd_spec_import" not in row or not isinstance(row.get("pd_spec_import"), dict):
            row["pd_spec_import"] = pd_spec_import_from_row(row)
        return row
    normalized = split_pd_spec_row(row)
    for key in list(row.keys()):
        if key not in normalized:
            del row[key]
    row.update(normalized)
    return row


def merge_canonical_updates(
    row: Mapping[str, Any],
    updates: Mapping[str, Any],
    *,
    for_enriched: bool = False,
) -> Dict[str, Any]:
    """Apply canonical field updates; preserve original_deviation_text and pd_spec_import."""
    base = split_pd_spec_row(row) if has_flat_pd_spec_fields(row) else dict(row)
    if "pd_spec_import" not in base or not isinstance(base.get("pd_spec_import"), dict):
        base = split_pd_spec_row(base)

    result = dict(base)
    pd_import = dict(result.get("pd_spec_import") or {})

    for key in CANONICAL_DEVIATION_KEYS:
        if key in updates:
            result[key] = updates[key]

    if for_enriched:
        if "original_deviation_text" in updates:
            result["original_deviation_text"] = updates["original_deviation_text"]
        elif "original_deviation_text" in row:
            result["original_deviation_text"] = row["original_deviation_text"]
        if "suggested_deviation_text" in updates:
            result["suggested_deviation_text"] = updates["suggested_deviation_text"]
        elif "suggested_deviation_text" in row:
            result["suggested_deviation_text"] = row["suggested_deviation_text"]

    pd_updates = updates.get("pd_spec_import")
    if isinstance(pd_updates, dict):
        pd_import.update(pd_updates)
    for key in PD_SPEC_IMPORT_KEYS:
        if key in updates and key not in CANONICAL_DEVIATION_KEYS:
            pd_import[key] = updates[key]

    result["pd_spec_import"] = pd_import
    return result


def build_enriched_row(
    deviation: Mapping[str, Any],
    canonical_updates: Mapping[str, Any],
) -> Dict[str, Any]:
    """Assemble enriched review row after merge."""
    base = split_pd_spec_row(deviation)
    original = str(
        canonical_updates.get("original_deviation_text")
        or base.get("original_deviation_text")
        or base.get("text", "")
    )
    updates = dict(canonical_updates)
    updates["original_deviation_text"] = original
    return merge_canonical_updates(base, updates, for_enriched=True)


def row_for_enrichment_llm(row: Mapping[str, Any]) -> Dict[str, Any]:
    """Flat view for enrichment prompts (category, pseudo_logic_seed, etc.)."""
    flat = dict(row)
    pd_import = row.get("pd_spec_import")
    if isinstance(pd_import, dict):
        for key in PD_SPEC_IMPORT_KEYS:
            if key not in flat or not str(flat.get(key, "")).strip():
                flat[key] = pd_import.get(key, "")
    return flat

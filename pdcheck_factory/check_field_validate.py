"""Validate generated checks against the ACRF field dictionary."""

from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List, Mapping, Sequence, Set, Tuple

from pdcheck_factory.acrf_field_dictionary import known_column_names, lookup_field

_DATASET_COL_RE = re.compile(
    r"\b([A-Z][A-Z0-9_]{0,15})\s*:\s*([A-Z][A-Z0-9_]{0,15})\b"
)
_COLUMN_TOKEN_RE = re.compile(r"\b([A-Z][A-Z0-9_]{1,15})\b")
_SKIP_TOKENS = {
    "AND",
    "OR",
    "NOT",
    "NULL",
    "WHERE",
    "BETWEEN",
    "SELECT",
    "FROM",
    "JOIN",
    "LEFT",
    "RIGHT",
    "INNER",
    "OUTER",
    "ON",
    "AS",
    "IS",
    "BY",
    "WITH",
    "WHEN",
    "THEN",
    "ELSE",
    "END",
    "CASE",
    "TRUE",
    "FALSE",
    "YES",
    "NO",
    "SV",
    "AE",
    "CM",
    "MH",
    "LB",
    "VS",
    "DM",
    "EX",
    "DS",
    "IE",
    "PE",
    "EG",
    "QS",
    "FA",
    "SU",
    "CE",
    "AG",
    "CO",
    "DD",
    "HO",
    "MB",
    "MS",
    "NV",
    "OE",
    "PC",
    "PP",
    "RE",
    "RP",
    "RS",
    "SC",
    "SR",
    "TR",
    "TU",
    "UR",
    "WK",
}


def _parse_data_refs(text: str) -> List[Tuple[str, str]]:
    refs: List[Tuple[str, str]] = []
    for match in _DATASET_COL_RE.finditer(text or ""):
        refs.append((match.group(1), match.group(2)))
    return refs


def _parse_column_tokens(text: str, known: Set[str]) -> List[str]:
    found: List[str] = []
    for token in _COLUMN_TOKEN_RE.findall(text or ""):
        if token in _SKIP_TOKENS:
            continue
        if token in known or token.upper() in known:
            found.append(token)
    return found


def extract_field_references(
    *,
    pseudo_logic: str = "",
    data_support_note: str = "",
    required_fields: Sequence[str] | None = None,
    dictionary_obj: Mapping[str, Any] | None = None,
) -> List[Dict[str, str]]:
    refs: List[Dict[str, str]] = []
    seen: Set[str] = set()
    known = known_column_names(dict(dictionary_obj or {}))

    for dataset_name, column_name in _parse_data_refs(pseudo_logic):
        key = f"{dataset_name}.{column_name}"
        if key not in seen:
            seen.add(key)
            refs.append({"dataset_name": dataset_name, "column_name": column_name})

    for dataset_name, column_name in _parse_data_refs(data_support_note):
        key = f"{dataset_name}.{column_name}"
        if key not in seen:
            seen.add(key)
            refs.append({"dataset_name": dataset_name, "column_name": column_name})

    for token in _parse_column_tokens(pseudo_logic, known):
        key = token
        if key not in seen:
            seen.add(key)
            refs.append({"dataset_name": "", "column_name": token})

    for token in _parse_column_tokens(data_support_note, known):
        key = token
        if key not in seen:
            seen.add(key)
            refs.append({"dataset_name": "", "column_name": token})

    for raw in required_fields or []:
        token = str(raw).strip()
        if not token:
            continue
        if "." in token:
            dataset_name, column_name = token.split(".", 1)
            key = f"{dataset_name}.{column_name}"
            if key not in seen:
                seen.add(key)
                refs.append({"dataset_name": dataset_name, "column_name": column_name})
        elif token not in seen:
            seen.add(token)
            refs.append({"dataset_name": "", "column_name": token})
    return refs


def validate_field_references(
    *,
    dictionary_obj: Mapping[str, Any],
    pseudo_logic: str = "",
    data_support_note: str = "",
    required_fields: Sequence[str] | None = None,
) -> Dict[str, Any]:
    refs = extract_field_references(
        pseudo_logic=pseudo_logic,
        data_support_note=data_support_note,
        required_fields=required_fields,
        dictionary_obj=dictionary_obj,
    )
    invalid: List[Dict[str, str]] = []
    valid: List[Dict[str, str]] = []
    for ref in refs:
        dataset_name = ref.get("dataset_name", "")
        column_name = ref.get("column_name", "")
        if lookup_field(dict(dictionary_obj), dataset_name, column_name):
            valid.append(ref)
        else:
            invalid.append(ref)
    return {
        "valid_fields": valid,
        "invalid_fields": invalid,
        "needs_mapping_review": bool(invalid),
    }


def apply_field_validation_to_item(
    item: Dict[str, Any],
    *,
    dictionary_obj: Mapping[str, Any],
) -> Dict[str, Any]:
    result = validate_field_references(
        dictionary_obj=dictionary_obj,
        pseudo_logic=str(item.get("pseudo_logic") or ""),
        data_support_note=str(item.get("data_support_note") or ""),
        required_fields=list(item.get("required_fields", []) or []),
    )
    out = dict(item)
    out["field_validation"] = result
    if result["needs_mapping_review"]:
        out["status"] = "needs_mapping_review"
        invalid = ", ".join(
            f"{r.get('dataset_name', '')}.{r.get('column_name', '')}".strip(".")
            for r in result["invalid_fields"]
        )
        note = str(out.get("programmability_note", "") or "").strip()
        extra = f"Unknown ACRF fields: {invalid}" if invalid else "Unknown ACRF fields detected."
        out["programmability_note"] = f"{note} {extra}".strip()
    return out

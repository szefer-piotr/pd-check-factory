"""Build a validated ACRF field dictionary from text-block summary output."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Tuple

_DATE_RE = re.compile(r"\b(date|dtc|dat)\b", re.I)
_TIME_RE = re.compile(r"\b(time|tim)\b", re.I)
_DATETIME_RE = re.compile(r"\b(datetime|date.?time|dttm)\b", re.I)
_NUMERIC_RE = re.compile(r"\b(numeric|number|integer|float|min|max|range)\b", re.I)
_CATEGORICAL_RE = re.compile(r"\b(categorical|category|enum|allowed|values?)\b", re.I)
_BOOLEAN_RE = re.compile(r"\b(boolean|yes/no|true/false)\b", re.I)


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _norm_key(value: str) -> str:
    return (value or "").strip().upper()


def _infer_type(column: Dict[str, Any]) -> str:
    explicit = str(column.get("column_type", "") or column.get("variable_type", "")).strip().lower()
    if explicit in {"categorical", "numeric", "date", "time", "datetime", "text", "boolean", "unknown"}:
        return explicit
    blob = " ".join(
        [
            str(column.get("column_values", "")),
            str(column.get("column_description", "")),
            str(column.get("allowed_values", "")),
        ]
    )
    if _DATETIME_RE.search(blob):
        return "datetime"
    if _DATE_RE.search(blob) or str(column.get("column_name", "")).upper().endswith("DAT"):
        return "date"
    if _TIME_RE.search(blob) or str(column.get("column_name", "")).upper().endswith("TIM"):
        return "time"
    if _BOOLEAN_RE.search(blob):
        return "boolean"
    if _CATEGORICAL_RE.search(blob) or column.get("allowed_values"):
        return "categorical"
    if _NUMERIC_RE.search(blob):
        return "numeric"
    return "unknown"


def _derive_form_name(dataset_name: str, columns: List[Dict[str, Any]]) -> str:
    for col in columns:
        desc = str(col.get("column_description", "")).strip()
        if desc and len(desc) > 3 and not desc.upper().startswith(dataset_name.upper()):
            return desc.split(" - ")[0].strip()
    return dataset_name.replace("_", " ").strip()


def build_field_dictionary(
    *,
    study_id: str,
    summary_obj: Dict[str, Any],
) -> Dict[str, Any]:
    warnings: List[str] = []
    by_dataset: Dict[str, Dict[str, Any]] = {}

    for dataset in summary_obj.get("datasets", []) or []:
        dataset_name = str(dataset.get("dataset_name", "")).strip()
        if not dataset_name:
            warnings.append("Skipped dataset with empty dataset_name.")
            continue
        dkey = _norm_key(dataset_name)
        bucket = by_dataset.setdefault(
            dkey,
            {"dataset_name": dataset_name, "form_name": "", "fields_by_col": {}},
        )
        columns = list(dataset.get("columns", []) or [])
        if not bucket["form_name"]:
            bucket["form_name"] = _derive_form_name(dataset_name, columns)
        for column in columns:
            column_name = str(column.get("column_name", "")).strip()
            if not column_name:
                warnings.append(f"Skipped empty column_name in dataset {dataset_name!r}.")
                continue
            label = str(column.get("column_description", "")).strip()
            field = {
                "column_name": column_name,
                "label": label,
                "type": _infer_type(column),
            }
            ckey = _norm_key(column_name)
            existing = bucket["fields_by_col"].get(ckey)
            if existing is None:
                bucket["fields_by_col"][ckey] = field
            else:
                if len(label) > len(str(existing.get("label", ""))):
                    existing["label"] = label
                if existing.get("type") == "unknown" and field["type"] != "unknown":
                    existing["type"] = field["type"]

    datasets_out: List[Dict[str, Any]] = []
    field_index: Dict[str, Dict[str, str]] = {}
    for dkey in sorted(by_dataset.keys()):
        bucket = by_dataset[dkey]
        fields = sorted(bucket["fields_by_col"].values(), key=lambda f: f["column_name"])
        datasets_out.append(
            {
                "dataset_name": bucket["dataset_name"],
                "form_name": bucket["form_name"],
                "fields": fields,
            }
        )
        for field in fields:
            index_key = f"{bucket['dataset_name']}.{field['column_name']}"
            field_index[index_key] = {
                "dataset_name": bucket["dataset_name"],
                "column_name": field["column_name"],
                "label": field["label"],
                "type": field["type"],
            }
            field_index[_norm_key(field["column_name"])] = field_index[index_key]

    return {
        "schema_version": "1.0.0",
        "study_id": study_id,
        "generated_at": _iso_now(),
        "datasets": datasets_out,
        "field_index": field_index,
        "normalization_warnings": warnings,
    }


def compact_dictionary_for_prompt(dictionary_obj: Dict[str, Any]) -> str:
    """Serialize the full field dictionary for LLM prompts (never truncated)."""
    import json

    compact = {
        "datasets": dictionary_obj.get("datasets", []),
        "field_index_keys": sorted(dictionary_obj.get("field_index", {}).keys()),
    }
    return json.dumps(compact, ensure_ascii=False, indent=2)


def lookup_field(dictionary_obj: Dict[str, Any], dataset_name: str, column_name: str) -> Dict[str, str] | None:
    field_index = dictionary_obj.get("field_index", {})
    direct = field_index.get(f"{dataset_name}.{column_name}")
    if direct:
        return direct
    return field_index.get(_norm_key(column_name))


def is_known_field(dictionary_obj: Dict[str, Any], dataset_name: str, column_name: str) -> bool:
    return lookup_field(dictionary_obj, dataset_name, column_name) is not None


def known_column_names(dictionary_obj: Dict[str, Any]) -> set[str]:
    names: set[str] = set()
    for ds in dictionary_obj.get("datasets", []):
        for field in ds.get("fields", []):
            col = str(field.get("column_name", "")).strip()
            if col:
                names.add(col)
                names.add(_norm_key(col))
    return names

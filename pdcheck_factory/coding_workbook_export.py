"""Export Step 7 deviations to the company PD Specifications workbook layout."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Sequence

from openpyxl import Workbook

from pdcheck_factory.pd_spec_export import (
    DICTIONARIES_SHEET_TITLE,
    PD_SPEC_HEADERS,
    PD_SPEC_SHEET_TITLE,
    _COL_CATEGORY,
    _COL_MANUAL_PROGRAMMABLE,
    _COL_PROGRAMMING_STATUS,
    _add_list_validation,
    _additional_information,
    _category_list_range,
    _format_pd_spec_sheet,
    _manual_programmable_list_range,
    _status_list_range,
    _write_dictionaries_sheet,
)

_DESCRIPTION_MAX_LEN = 250
_DATA_SOURCE_MAX_LEN = 30


def _truncate(text: str, max_len: int) -> str:
    value = str(text).strip()
    if len(value) <= max_len:
        return value
    return value[: max_len - 3].rstrip() + "..."


def _format_supporting_sentences(sentences: Sequence[Dict[str, Any]]) -> str:
    parts: List[str] = []
    for item in sentences:
        ref = str(item.get("ref", "")).strip()
        text = str(item.get("text", "")).strip()
        if ref and text:
            parts.append(f"{ref}: {text}")
        elif text:
            parts.append(text)
    return " | ".join(parts)


def _manual_or_programmable(programmable: Any) -> str:
    if programmable is True:
        return "Programmable"
    if programmable is False:
        return "Manual"
    return ""


def _exported_date(exported_at: str) -> str:
    value = str(exported_at).strip()
    if not value:
        return ""
    return value[:10] if len(value) >= 10 else value


def _step7_additional_information(row: Dict[str, Any], *, study_id: str) -> str:
    """Pack Step 7 review context not mapped to dedicated PD Spec columns."""
    parts: List[str] = []
    base = _additional_information(row)
    if base:
        parts.extend(base.splitlines())

    rule_text = str(row.get("rule_text", "")).strip()
    if rule_text:
        parts.append(f"rule_text: {rule_text}")

    supporting = _format_supporting_sentences(list(row.get("supporting_sentences", [])))
    if supporting:
        parts.append(f"supporting_sentences: {supporting}")

    data_support_note = str(row.get("data_support_note", "")).strip()
    if data_support_note:
        parts.append(f"data_support_note: {data_support_note}")

    status = str(row.get("status", "")).strip()
    if status:
        parts.append(f"review_status: {status}")

    entry_source = str(row.get("entry_source", "")).strip()
    if entry_source:
        parts.append(f"entry_source: {entry_source}")

    if study_id:
        parts.append(f"study_id: {study_id}")

    return "\n".join(parts)


def map_step7_row_to_pd_spec_row(
    row: Dict[str, Any],
    *,
    study_id: str,
    exported_at: str,
) -> List[str]:
    """Map one normalized Step 7 row to a company PD Specifications data row."""
    data_support_note = str(row.get("data_support_note", "") or "").strip()
    return [
        str(row.get("rule_title", "") or "").strip(),
        "",
        _truncate(str(row.get("deviation_text", "") or ""), _DESCRIPTION_MAX_LEN),
        _exported_date(exported_at),
        str(row.get("status", "") or "").strip(),
        _manual_or_programmable(row.get("programmable")),
        _step7_additional_information(row, study_id=study_id),
        "",
        _truncate(data_support_note, _DATA_SOURCE_MAX_LEN),
        str(row.get("pseudo_logic", "") or "").strip(),
        str(row.get("programmability_note", "") or "").strip(),
        str(row.get("dm_comment", "") or "").strip(),
        "",
    ]


# Backward-compatible aliases used by tests and imports.
CODING_HEADERS = PD_SPEC_HEADERS
CODING_SHEET_TITLE = PD_SPEC_SHEET_TITLE
map_step7_row_to_coding_row = map_step7_row_to_pd_spec_row


def write_coding_workbook_xlsx(
    rows: Sequence[Dict[str, Any]],
    out_path: Path,
    *,
    study_id: str,
    exported_at: str,
) -> None:
    """Write Step 7 rows to a company PD Specifications workbook."""
    wb = Workbook()
    dict_ws = wb.active
    dict_ws.title = DICTIONARIES_SHEET_TITLE
    _write_dictionaries_sheet(dict_ws)

    ws = wb.create_sheet(PD_SPEC_SHEET_TITLE, 0)
    ws.append(PD_SPEC_HEADERS)
    for row in rows:
        ws.append(map_step7_row_to_pd_spec_row(row, study_id=study_id, exported_at=exported_at))

    _format_pd_spec_sheet(ws, data_row_count=len(rows))
    _add_list_validation(ws, column_index=_COL_CATEGORY, formula_range=_category_list_range())
    _add_list_validation(
        ws,
        column_index=_COL_MANUAL_PROGRAMMABLE,
        formula_range=_manual_programmable_list_range(),
    )
    _add_list_validation(
        ws,
        column_index=_COL_PROGRAMMING_STATUS,
        formula_range=_status_list_range(),
    )

    out_path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(out_path)

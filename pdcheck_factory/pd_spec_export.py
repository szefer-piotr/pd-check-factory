"""Export deviations to the NAL00-107 PD Specifications workbook layout."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Mapping, Sequence

from openpyxl import Workbook
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.worksheet.worksheet import Worksheet

from pdcheck_factory.pd_taxonomy import (
    all_sub_category_options,
    category_options,
    export_headers,
    load_template_meta,
    programming_status_options,
)

PD_SPEC_SHEET_TITLE = "PD Specifications"

# Backward-compatible aliases
DICTIONARIES_SHEET_TITLE = "Dictionaries"

PD_SPEC_HEADERS: List[str] = export_headers() or [
    "Protocol Deviation Category",
    "Protocol Deviation Sub-Category",
    "Protocol Deviation Description\n250 Character Limit",
    "Protocol Deviation Occurrence Date",
    "Protocol Deviation Classification",
    "Manual or Programmable Deviation",
    "Additional Information / Comments",
    "Programming Status",
    "Data Source (e.g., RAVE, Clario, LabConnect)\n30 Character Limit",
    "Programming Information",
    "Programmer Comments",
    "Reviewer Comments",
    "Programmer Check Number",
]

PD_CATEGORY_OPTIONS: List[str] = category_options()

PROGRAMMING_STATUS_OPTIONS: List[str] = programming_status_options() or [
    "Specd for CTL Review",
    "Not Applicable",
    "Question - Pending",
    "Ready for Programming",
    "Programmed",
    "Programmed - Ready for Review",
    "Review Failed",
    "Completed",
]

MANUAL_OR_PROGRAMMABLE_OPTIONS: List[str] = ["Manual", "Programmable"]

_COL_CATEGORY = 1
_COL_SUB_CATEGORY = 2
_COL_MANUAL_PROGRAMMABLE = 6
_COL_PROGRAMMING_STATUS = 8

_DEFAULT_COLUMN_WIDTHS = {
    1: 28,
    2: 28,
    3: 48,
    4: 22,
    5: 24,
    6: 26,
    7: 36,
    8: 22,
    9: 32,
    10: 48,
    11: 28,
    12: 28,
    13: 24,
}


def _column_widths() -> Dict[int, float]:
    meta = load_template_meta()
    raw = meta.get("column_widths")
    if isinstance(raw, dict) and raw:
        return {int(k): float(v) for k, v in raw.items()}
    return dict(_DEFAULT_COLUMN_WIDTHS)


def _field(item: Mapping[str, Any], *keys: str, default: str = "") -> str:
    for key in keys:
        value = item.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return default


def _manual_or_programmable_value(item: Mapping[str, Any]) -> str:
    explicit = _field(item, "manual_or_programmable")
    if explicit in MANUAL_OR_PROGRAMMABLE_OPTIONS:
        return explicit
    programmable = item.get("programmable")
    if programmable is True:
        return "Programmable"
    if programmable is False:
        return "Manual"
    return ""


def map_deviation_to_pd_spec_row(item: Mapping[str, Any]) -> List[str]:
    """Map one deviation item to a PD Specifications data row."""
    return [
        _field(item, "protocol_deviation_category"),
        _field(item, "protocol_deviation_sub_category"),
        _field(item, "deviation_text", "text"),
        "",
        _field(item, "classification"),
        _manual_or_programmable_value(item),
        "",
        _field(item, "programming_status"),
        _field(item, "data_source"),
        _field(item, "pseudo_logic"),
        "",
        "",
        "",
    ]


def map_final_item_to_pd_spec_row(item: Dict[str, Any]) -> List[str]:
    """Backward-compatible alias for final_deviations_v2 items."""
    return map_deviation_to_pd_spec_row(item)


def ws_column_letter(col_idx: int) -> str:
    result = ""
    n = col_idx
    while n:
        n, remainder = divmod(n - 1, 26)
        result = chr(65 + remainder) + result
    return result


def _inline_list_formula(values: Sequence[str]) -> str:
    escaped = [str(v).replace('"', '""') for v in values if str(v).strip()]
    return '"' + ",".join(escaped) + '"'


def _add_inline_list_validation(
    ws: Worksheet,
    *,
    column_index: int,
    values: Sequence[str],
    first_data_row: int = 2,
    last_data_row: int = 1048576,
) -> None:
    if not values:
        return
    col_letter = ws_column_letter(column_index)
    validation = DataValidation(
        type="list",
        formula1=f"={_inline_list_formula(values)}",
        allow_blank=True,
    )
    ws.add_data_validation(validation)
    validation.add(f"{col_letter}{first_data_row}:{col_letter}{last_data_row}")


def _format_pd_spec_sheet(ws: Worksheet, *, data_row_count: int) -> None:
    meta = load_template_meta()
    freeze = str(meta.get("freeze_panes") or "A2")
    ws.freeze_panes = freeze
    if data_row_count > 0:
        ws.auto_filter.ref = f"A1:{ws_column_letter(len(PD_SPEC_HEADERS))}{data_row_count + 1}"
    for col_idx, width in _column_widths().items():
        ws.column_dimensions[ws_column_letter(col_idx)].width = width


def _apply_validations(ws: Worksheet) -> None:
    _add_inline_list_validation(ws, column_index=_COL_CATEGORY, values=PD_CATEGORY_OPTIONS)
    _add_inline_list_validation(ws, column_index=_COL_SUB_CATEGORY, values=all_sub_category_options())
    _add_inline_list_validation(
        ws,
        column_index=_COL_MANUAL_PROGRAMMABLE,
        values=MANUAL_OR_PROGRAMMABLE_OPTIONS,
    )
    _add_inline_list_validation(
        ws,
        column_index=_COL_PROGRAMMING_STATUS,
        values=PROGRAMMING_STATUS_OPTIONS,
    )


def write_pd_spec_xlsx(rows: Sequence[Mapping[str, Any]], out_path: Path) -> None:
    """Write deviation rows to a single-sheet PD Specifications workbook."""
    wb = Workbook()
    ws = wb.active
    ws.title = PD_SPEC_SHEET_TITLE
    ws.append(PD_SPEC_HEADERS)
    for item in rows:
        ws.append(map_deviation_to_pd_spec_row(item))

    _format_pd_spec_sheet(ws, data_row_count=len(rows))
    _apply_validations(ws)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(out_path)


def write_final_pd_spec_xlsx(final_obj: Dict[str, Any], out_path: Path) -> None:
    """Write final deviations JSON to a PD Specifications workbook."""
    items: Sequence[Dict[str, Any]] = final_obj.get("items", [])
    write_pd_spec_xlsx(items, out_path)

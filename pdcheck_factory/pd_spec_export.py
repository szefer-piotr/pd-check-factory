"""Export final deviations to the company PD Specifications workbook layout."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Sequence

from openpyxl import Workbook
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.worksheet.worksheet import Worksheet

PD_SPEC_SHEET_TITLE = "PD Specifications"
DICTIONARIES_SHEET_TITLE = "Dictionaries"

PD_SPEC_HEADERS: List[str] = [
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
    "AA comment",
]

# Top-level categories observed in schemas/examples/NAL00-106 PD Specifications.xlsx
PD_CATEGORY_OPTIONS: List[str] = [
    "AE/SAE Reporting",
    "Concomitant/ Rescue Medication",
    "Eligibility Criteria",
    "Informed Consent/Assent",
    "Investigational Product/Device",
    "IRB/EC Regulatory",
    "Other, specify",
    "Randomization Related",
    "Study Procedure Related",
    "Study Visit Related",
]

PROGRAMMING_STATUS_OPTIONS: List[str] = [
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

# Column letters for validations (1-based index in PD_SPEC_HEADERS)
_COL_CATEGORY = 1
_COL_MANUAL_PROGRAMMABLE = 6
_COL_PROGRAMMING_STATUS = 8

_PD_SPEC_COLUMN_WIDTHS = {
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


def _additional_information(item: Dict[str, Any]) -> str:
    """Build concise context for the Additional Information / Comments column."""
    parts: List[str] = []
    rule_id = str(item.get("rule_id", "")).strip()
    deviation_id = str(item.get("deviation_id", "")).strip()
    rule_title = str(item.get("rule_title", "")).strip()
    paragraph_refs = ", ".join(str(ref) for ref in item.get("paragraph_refs", []))
    if rule_id:
        parts.append(f"rule_id: {rule_id}")
    if deviation_id:
        parts.append(f"deviation_id: {deviation_id}")
    if rule_title:
        parts.append(f"rule_title: {rule_title}")
    if paragraph_refs:
        parts.append(f"paragraph_refs: {paragraph_refs}")
    return "\n".join(parts)


def map_final_item_to_pd_spec_row(item: Dict[str, Any]) -> List[str]:
    """Map one final_deviations_v2 item to a PD Specifications data row."""
    return [
        str(item.get("protocol_deviation_category", "") or "").strip(),
        str(item.get("protocol_deviation_sub_category", "") or "").strip(),
        str(item.get("deviation_text", "") or "").strip(),
        str(item.get("occurrence_date", "") or "").strip(),
        str(item.get("classification", "") or "").strip(),
        str(item.get("manual_or_programmable", "") or "").strip(),
        _additional_information(item),
        str(item.get("programming_status", "") or "").strip(),
        str(item.get("data_source", "") or "").strip(),
        str(item.get("pseudo_logic", "") or "").strip(),
        str(item.get("programmer_comments", "") or "").strip(),
        str(item.get("reviewer_comments", "") or "").strip(),
        str(item.get("aa_comment", "") or "").strip(),
    ]


def _write_dictionaries_sheet(ws: Worksheet) -> None:
    for col_idx, category in enumerate(PD_CATEGORY_OPTIONS, start=1):
        ws.cell(row=1, column=col_idx, value=category)
    for row_idx, status in enumerate(PROGRAMMING_STATUS_OPTIONS, start=1):
        ws.cell(row=row_idx, column=len(PD_CATEGORY_OPTIONS) + 2, value=status)
    for row_idx, option in enumerate(MANUAL_OR_PROGRAMMABLE_OPTIONS, start=1):
        ws.cell(row=row_idx, column=len(PD_CATEGORY_OPTIONS) + 4, value=option)


def _category_list_range() -> str:
    end_col = chr(ord("A") + len(PD_CATEGORY_OPTIONS) - 1)
    return f"{DICTIONARIES_SHEET_TITLE}!$A$1:${end_col}$1"


def _status_list_range() -> str:
    status_col = len(PD_CATEGORY_OPTIONS) + 2
    col_letter = ws_column_letter(status_col)
    end_row = len(PROGRAMMING_STATUS_OPTIONS)
    return f"{DICTIONARIES_SHEET_TITLE}!${col_letter}$1:${col_letter}${end_row}"


def _manual_programmable_list_range() -> str:
    mp_col = len(PD_CATEGORY_OPTIONS) + 4
    col_letter = ws_column_letter(mp_col)
    end_row = len(MANUAL_OR_PROGRAMMABLE_OPTIONS)
    return f"{DICTIONARIES_SHEET_TITLE}!${col_letter}$1:${col_letter}${end_row}"


def ws_column_letter(col_idx: int) -> str:
    result = ""
    n = col_idx
    while n:
        n, remainder = divmod(n - 1, 26)
        result = chr(65 + remainder) + result
    return result


def _add_list_validation(
    ws: Worksheet,
    *,
    column_index: int,
    formula_range: str,
    first_data_row: int = 2,
    last_data_row: int = 1048576,
) -> None:
    col_letter = ws_column_letter(column_index)
    validation = DataValidation(
        type="list",
        formula1=f"={formula_range}",
        allow_blank=True,
    )
    ws.add_data_validation(validation)
    validation.add(f"{col_letter}{first_data_row}:{col_letter}{last_data_row}")


def _format_pd_spec_sheet(ws: Worksheet, *, data_row_count: int) -> None:
    ws.freeze_panes = "A2"
    if data_row_count > 0:
        ws.auto_filter.ref = f"A1:{ws_column_letter(len(PD_SPEC_HEADERS))}{data_row_count + 1}"
    for col_idx, width in _PD_SPEC_COLUMN_WIDTHS.items():
        ws.column_dimensions[ws_column_letter(col_idx)].width = width


def write_final_pd_spec_xlsx(final_obj: Dict[str, Any], out_path: Path) -> None:
    """Write final deviations JSON to a PD Specifications workbook."""
    wb = Workbook()
    dict_ws = wb.active
    dict_ws.title = DICTIONARIES_SHEET_TITLE
    _write_dictionaries_sheet(dict_ws)

    ws = wb.create_sheet(PD_SPEC_SHEET_TITLE, 0)
    ws.append(PD_SPEC_HEADERS)
    items: Sequence[Dict[str, Any]] = final_obj.get("items", [])
    for item in items:
        ws.append(map_final_item_to_pd_spec_row(item))

    _format_pd_spec_sheet(ws, data_row_count=len(items))
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

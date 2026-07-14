"""Export Step 7 deviations to the company PD Specifications workbook layout."""

from __future__ import annotations

import csv
from io import StringIO
from pathlib import Path
from typing import Any, Dict, Mapping, Sequence

from pdcheck_factory.pd_spec_export import (
    PD_SPEC_HEADERS,
    PD_SPEC_SHEET_TITLE,
    map_deviation_to_pd_spec_row,
    write_pd_spec_xlsx,
)
from pdcheck_factory.pd_taxonomy import normalize_category_pair
from pdcheck_factory.deviation_contract import pd_spec_field

# Backward-compatible aliases
CODING_HEADERS = PD_SPEC_HEADERS
CODING_SHEET_TITLE = PD_SPEC_SHEET_TITLE


def _resolve_data_source(row: Mapping[str, Any], *, study_id: str) -> str:
    del study_id
    explicit = pd_spec_field(row, "data_source").strip()
    if explicit:
        return explicit
    acrf_summary = str(row.get("acrf_summary_hint", "") or "").lower()
    entry_source = str(row.get("entry_source", "") or "").lower()
    if "rave" in acrf_summary or entry_source in {"", "extracted", "generated"}:
        return "Rave"
    return ""


def _row_for_export(row: Mapping[str, Any], *, study_id: str) -> Dict[str, Any]:
    category = pd_spec_field(row, "protocol_deviation_category").strip()
    if not category:
        category = str(row.get("rule_title", "") or "").strip()
    sub_category = pd_spec_field(row, "protocol_deviation_sub_category").strip()
    category, sub_category = normalize_category_pair(category, sub_category)

    return {
        "protocol_deviation_category": category,
        "protocol_deviation_sub_category": sub_category,
        "deviation_text": str(row.get("deviation_text", row.get("text", "")) or ""),
        "classification": pd_spec_field(row, "classification").strip(),
        "programmable": row.get("programmable"),
        "manual_or_programmable": pd_spec_field(row, "manual_or_programmable"),
        "programming_status": pd_spec_field(row, "programming_status"),
        "data_source": _resolve_data_source(row, study_id=study_id),
        "pseudo_logic": str(row.get("pseudo_logic", "") or ""),
    }


def map_step7_row_to_pd_spec_row(
    row: Dict[str, Any],
    *,
    study_id: str,
    exported_at: str = "",
) -> list[str]:
    """Map one normalized Step 7 row to a company PD Specifications data row."""
    del exported_at
    return map_deviation_to_pd_spec_row(_row_for_export(row, study_id=study_id))


map_step7_row_to_coding_row = map_step7_row_to_pd_spec_row


def write_coding_workbook_xlsx(
    rows: Sequence[Dict[str, Any]],
    out_path: Path,
    *,
    study_id: str,
    exported_at: str,
) -> None:
    """Write Step 7 rows to a company PD Specifications workbook."""
    del exported_at
    export_rows = [_row_for_export(row, study_id=study_id) for row in rows]
    write_pd_spec_xlsx(export_rows, out_path)


def filter_accepted_rows(rows: Sequence[Mapping[str, Any]]) -> list[Dict[str, Any]]:
    return [dict(row) for row in rows if str(row.get("status", "")).strip().lower() == "accepted"]


def rows_to_company_pd_spec_matrix(
    rows: Sequence[Mapping[str, Any]],
    *,
    study_id: str,
    accepted_only: bool = True,
) -> tuple[list[str], list[list[str]]]:
    """Return headers and data rows for company PD spec export."""
    selected = filter_accepted_rows(rows) if accepted_only else [dict(row) for row in rows]
    headers = list(PD_SPEC_HEADERS)
    matrix = [map_step7_row_to_pd_spec_row(row, study_id=study_id) for row in selected]
    return headers, matrix


def write_coding_workbook_csv(
    rows: Sequence[Mapping[str, Any]],
    out_path: Path,
    *,
    study_id: str,
    accepted_only: bool = True,
) -> int:
    """Write accepted Step 7 rows to company PD Specifications CSV."""
    headers, matrix = rows_to_company_pd_spec_matrix(
        rows,
        study_id=study_id,
        accepted_only=accepted_only,
    )
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(headers)
        writer.writerows(matrix)
    return len(matrix)


def coding_workbook_csv_bytes(
    rows: Sequence[Mapping[str, Any]],
    *,
    study_id: str,
    accepted_only: bool = True,
) -> bytes:
    """Return company PD Specifications CSV as UTF-8 bytes."""
    buffer = StringIO()
    headers, matrix = rows_to_company_pd_spec_matrix(
        rows,
        study_id=study_id,
        accepted_only=accepted_only,
    )
    writer = csv.writer(buffer)
    writer.writerow(headers)
    writer.writerows(matrix)
    return buffer.getvalue().encode("utf-8")

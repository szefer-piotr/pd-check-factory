"""Tests for company PD spec CSV export."""

from __future__ import annotations

import csv
from pathlib import Path

from pdcheck_factory import coding_workbook_export
from pdcheck_factory.pd_spec_export import PD_SPEC_HEADERS


def test_coding_workbook_csv_accepted_only(tmp_path: Path) -> None:
    rows = [
        {
            "status": "accepted",
            "deviation_text": "Visit outside window",
            "protocol_deviation_category": "Study Visit Related",
            "protocol_deviation_sub_category": "Study Visit Out of Window",
            "pseudo_logic": "SV: visit_date NOT BETWEEN anchor+3 AND anchor+5",
            "programmable": True,
        },
        {
            "status": "pending",
            "deviation_text": "Should not export",
            "text": "Should not export",
        },
    ]
    out_path = tmp_path / "export.csv"
    count = coding_workbook_export.write_coding_workbook_csv(
        rows,
        out_path,
        study_id="STUDY-1",
        accepted_only=True,
    )
    assert count == 1
    with out_path.open(encoding="utf-8", newline="") as handle:
        rows_read = list(csv.reader(handle))
    assert len(rows_read) == 2
    assert len(rows_read[0]) == len(PD_SPEC_HEADERS)
    assert "Visit outside window" in rows_read[1][2]
    assert "Should not export" not in out_path.read_text(encoding="utf-8")


def test_coding_workbook_csv_empty_when_no_accepted(tmp_path: Path) -> None:
    rows = [{"status": "pending", "deviation_text": "x", "text": "x"}]
    out_path = tmp_path / "empty.csv"
    count = coding_workbook_export.write_coding_workbook_csv(
        rows,
        out_path,
        study_id="STUDY-1",
        accepted_only=True,
    )
    assert count == 0
    with out_path.open(encoding="utf-8", newline="") as handle:
        rows_read = list(csv.reader(handle))
    assert len(rows_read) == 1

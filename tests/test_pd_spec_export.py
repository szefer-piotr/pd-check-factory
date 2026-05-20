from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from openpyxl import load_workbook

from pdcheck_factory.pd_spec_export import (
    DICTIONARIES_SHEET_TITLE,
    PD_SPEC_HEADERS,
    PD_SPEC_SHEET_TITLE,
    map_final_item_to_pd_spec_row,
    write_final_pd_spec_xlsx,
)


class PdSpecExportTests(unittest.TestCase):
    def test_map_final_item_to_pd_spec_row(self) -> None:
        item = {
            "rule_id": "R1",
            "deviation_id": "D1",
            "rule_title": "Timing rule",
            "deviation_text": "Visit outside window.",
            "paragraph_refs": ["p12", "p13"],
            "pseudo_logic": "IF visit_date NOT IN window THEN flag",
        }
        row = map_final_item_to_pd_spec_row(item)
        self.assertEqual(row[2], "Visit outside window.")
        self.assertEqual(row[9], "IF visit_date NOT IN window THEN flag")
        self.assertIn("rule_id: R1", row[6])
        self.assertIn("deviation_id: D1", row[6])
        self.assertIn("rule_title: Timing rule", row[6])
        self.assertIn("paragraph_refs: p12, p13", row[6])
        self.assertEqual(row[0], "")
        self.assertEqual(row[7], "")

    def test_write_final_pd_spec_xlsx_structure(self) -> None:
        final_obj = {
            "schema_version": "1.0.0",
            "study_id": "TEST-STUDY",
            "generated_at": "2026-05-19T10:00:00+00:00",
            "items": [
                {
                    "rule_id": "R1",
                    "deviation_id": "D1",
                    "rule_title": "Timing",
                    "deviation_text": "Deviation one.",
                    "paragraph_refs": ["p1"],
                    "pseudo_logic": "pseudo one",
                },
                {
                    "rule_id": "R2",
                    "deviation_id": "D2",
                    "rule_title": "Dosing",
                    "deviation_text": "Deviation two.",
                    "paragraph_refs": ["p2", "p3"],
                    "pseudo_logic": "pseudo two",
                },
            ],
        }
        with tempfile.TemporaryDirectory() as tmp:
            out_path = Path(tmp) / "final_deviations.xlsx"
            write_final_pd_spec_xlsx(final_obj, out_path)
            self.assertTrue(out_path.is_file())

            wb = load_workbook(out_path)
            self.assertEqual(wb.sheetnames[0], PD_SPEC_SHEET_TITLE)
            self.assertIn(DICTIONARIES_SHEET_TITLE, wb.sheetnames)

            ws = wb[PD_SPEC_SHEET_TITLE]
            headers = [cell.value for cell in ws[1]]
            self.assertEqual(headers, PD_SPEC_HEADERS)
            self.assertEqual(ws["C2"].value, "Deviation one.")
            self.assertEqual(ws["J2"].value, "pseudo one")
            self.assertIn("rule_id: R1", ws["G2"].value)
            self.assertEqual(ws["C3"].value, "Deviation two.")
            self.assertEqual(ws["J3"].value, "pseudo two")

            dict_ws = wb[DICTIONARIES_SHEET_TITLE]
            categories = [dict_ws.cell(row=1, column=c).value for c in range(1, 11)]
            self.assertEqual(categories[0], "AE/SAE Reporting")
            self.assertEqual(categories[-1], "Study Visit Related")

            self.assertGreater(len(ws.data_validations.dataValidation), 0)


if __name__ == "__main__":
  unittest.main()

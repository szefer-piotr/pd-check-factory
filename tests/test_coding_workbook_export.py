from __future__ import annotations

import unittest

from pdcheck_factory.coding_workbook_export import map_step7_row_to_pd_spec_row


class CodingWorkbookExportTests(unittest.TestCase):
    def test_map_step7_row_preserves_long_description(self) -> None:
        row = {
            "deviation_id": "dev-0003",
            "rule_id": "rule-003",
            "deviation_text": "x" * 300,
            "status": "accepted",
            "programmable": True,
            "pseudo_logic": "SV: flag",
            "pd_spec_import": {
                "protocol_deviation_category": "Study Visit Related",
                "protocol_deviation_sub_category": "Study Visit Out of Window",
            },
        }
        mapped = map_step7_row_to_pd_spec_row(row, study_id="STUDY", exported_at="2026-05-21T12:00:00Z")
        self.assertEqual(len(mapped[2]), 300)
        self.assertEqual(mapped[3], "")
        self.assertEqual(mapped[0], "Study Visit Related")
        self.assertEqual(mapped[8], "Rave")

    def test_manual_or_programmable_manual(self) -> None:
        row = {
            "deviation_id": "dev-0002",
            "rule_id": "rule-002",
            "deviation_text": "Dose mismatch.",
            "status": "pending",
            "programmable": False,
        }
        mapped = map_step7_row_to_pd_spec_row(row, study_id="STUDY", exported_at="2026-05-21T12:00:00Z")
        self.assertEqual(mapped[5], "Manual")


if __name__ == "__main__":
    unittest.main()

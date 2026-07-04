from __future__ import annotations

import unittest

from pdcheck_factory.pd_spec_validate import validate_final_deviations


class PdSpecValidateTests(unittest.TestCase):
    def test_valid_final_object(self) -> None:
        final_obj = {
            "items": [
                {
                    "deviation_id": "dev-0001",
                    "rule_id": "rule-001",
                    "deviation_text": "Week 4 visit conducted outside Day 28 ±2 window.",
                    "paragraph_refs": ["p1"],
                    "pseudo_logic": "SV: visit_date NOT BETWEEN anchor-2 AND anchor+2",
                    "protocol_deviation_category": "Study Visit Related",
                    "protocol_deviation_sub_category": "Study Visit Out of Window",
                }
            ]
        }
        report = validate_final_deviations(final_obj)
        self.assertTrue(report.ok)

    def test_empty_description_fails(self) -> None:
        final_obj = {
            "items": [
                {
                    "deviation_id": "dev-0001",
                    "rule_id": "rule-001",
                    "deviation_text": "",
                    "paragraph_refs": ["p1"],
                    "pseudo_logic": "SV: flag",
                }
            ]
        }
        report = validate_final_deviations(final_obj)
        self.assertFalse(report.ok)
        self.assertTrue(any(issue.code == "empty_description" for issue in report.errors))

    def test_long_description_warns(self) -> None:
        final_obj = {
            "items": [
                {
                    "deviation_id": "dev-0001",
                    "rule_id": "rule-001",
                    "deviation_text": "x" * 260,
                    "paragraph_refs": ["p1"],
                    "pseudo_logic": "SV: flag",
                }
            ]
        }
        report = validate_final_deviations(final_obj)
        self.assertTrue(report.ok)
        self.assertTrue(any(issue.code == "description_length_soft" for issue in report.warnings))


if __name__ == "__main__":
    unittest.main()

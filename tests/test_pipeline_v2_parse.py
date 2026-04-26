from __future__ import annotations

import unittest

from pdcheck_factory import text_parse


class PipelineV2ParseTests(unittest.TestCase):
    def test_parse_rules_v2_blocks(self) -> None:
        text = """
<<<BEGIN_RULE>>>
RULE_TITLE: Timing
RULE_TEXT: Dose visit must occur in window.
PARAGRAPH_REFS: p12, p13
COVERAGE_NOTE: dosing
<<<END_RULE>>>
"""
        items = text_parse.parse_rules_v2_blocks(text)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["paragraph_refs"], ["p12", "p13"])

    def test_parse_deviations_v2_blocks(self) -> None:
        text = """
<<<BEGIN_DEVIATION>>>
DEVIATION_TEXT: Visit occurred outside allowed window.
PARAGRAPH_REFS: p22
DATA_SUPPORT_NOTE: compare visit date to allowed range.
<<<END_DEVIATION>>>
"""
        items = text_parse.parse_deviations_v2_blocks(text)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["paragraph_refs"], ["p22"])

    def test_parse_acrf_dataset_blocks(self) -> None:
        text = """
<<<BEGIN_DATASET>>>
DATASET_NAME: VS
COLUMN_NAME: visit_date
COLUMN_DESCRIPTION: Date of visit
COLUMN_VALUES: YYYY-MM-DD
<<<END_DATASET>>>
"""
        items = text_parse.parse_acrf_dataset_blocks(text)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["dataset_name"], "VS")


if __name__ == "__main__":
    unittest.main()

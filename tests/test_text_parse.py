from __future__ import annotations

import unittest

from pdcheck_factory import text_parse


class TextParseTests(unittest.TestCase):
    def test_parse_rule_blocks(self) -> None:
        text = """
<<<BEGIN_RULE>>>
TITLE: Visit timing
ATOMIC_REQUIREMENT: Visit 2 occurs within window.
SENTENCE_REFS: sec:x#s1, sec:x#s2
<<<END_RULE>>>
"""
        rules = text_parse.parse_rule_blocks(text)
        self.assertEqual(len(rules), 1)
        self.assertEqual(rules[0]["title"], "Visit timing")
        self.assertEqual(rules[0]["sentence_refs"], ["sec:x#s1", "sec:x#s2"])

    def test_parse_deviation_blocks(self) -> None:
        text = """
<<<BEGIN_DEVIATION>>>
SCENARIO: Missed visit
EXAMPLE: Subject skipped Visit 2 entirely.
SENTENCE_REFS: sec:x#s1
<<<END_DEVIATION>>>
"""
        d = text_parse.parse_deviation_blocks(text)
        self.assertEqual(len(d), 1)
        self.assertIn("Missed visit", d[0]["scenario_description"])

    def test_parse_programmability(self) -> None:
        text = "PROGRAMMABLE: yes\nRATIONALE: Uses visit_date column.\n"
        prog, rat = text_parse.parse_programmability(text)
        self.assertTrue(prog)
        self.assertIn("visit_date", rat)

    def test_parse_dedup_judgement(self) -> None:
        text = "IS_DUPLICATE: no\nCONFIDENCE: 0.9\nRATIONALE: Different scope.\n"
        j = text_parse.parse_dedup_judgement(text)
        self.assertFalse(j["is_duplicate"])
        self.assertEqual(j["confidence"], 0.9)

    def test_parse_revalidated_blocks(self) -> None:
        text = """
<<<BEGIN_DEVIATION>>>
SCENARIO: Late assessment
EXAMPLE: CRP drawn 5 days late.
SENTENCE_REFS: sec:y#s3
PROGRAMMABLE: yes
PSEUDO_SQL: SELECT 1 FROM labs WHERE days_late > 3
<<<END_DEVIATION>>>
"""
        items = text_parse.parse_revalidated_deviation_blocks(text)
        self.assertEqual(len(items), 1)
        self.assertTrue(items[0]["programmable"])
        self.assertIn("SELECT 1", items[0]["pseudo_sql_logic"])


if __name__ == "__main__":
    unittest.main()

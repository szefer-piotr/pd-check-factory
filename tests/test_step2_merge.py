from __future__ import annotations

import unittest
from unittest.mock import patch

from pdcheck_factory.step2_merge import merge_step1_outputs


def _step1_obj(section_id: str, path: list[str], title: str, req: str, scenario: str) -> dict:
    return {
        "schema_version": "3.0.0",
        "study_id": "study-x",
        "generated_at": "2026-01-01T00:00:00+00:00",
        "section_id": section_id,
        "section_path": path,
        "rules": [
            {
                "rule_id": "R1",
                "title": title,
                "atomic_requirement": req,
                "sentence_refs": [f"{section_id}#s1"],
                "candidate_deviations": [
                    {
                        "deviation_id": "D1",
                        "scenario_description": scenario,
                        "example_violation_narrative": "Example",
                        "sentence_refs": [f"{section_id}#s1"],
                        "programmable": True,
                        "pseudo_sql_logic": "SELECT subject_id FROM dm WHERE age < 18",
                    }
                ],
            }
        ],
    }


class Step2MergeTests(unittest.TestCase):
    def test_merges_duplicates_with_injected_judges(self) -> None:
        objs = [
            _step1_obj(
                "sec:a",
                ["A"],
                "Age Inclusion Criterion",
                "Participant must be 18 to 64 years old at screening.",
                "Age outside allowed range.",
            ),
            _step1_obj(
                "sec:b",
                ["B"],
                "Age criterion",
                "Participant age must be between 18 and 64 inclusive at screening.",
                "Participant age out of range.",
            ),
        ]
        out = merge_step1_outputs(
            study_id="study-x",
            step1_objects=objs,
            rule_duplicate_judge=lambda _a, _b: True,
            deviation_duplicate_judge=lambda _a, _b: True,
        )
        self.assertEqual(len(out["rules"]), 1)
        r = out["rules"][0]
        self.assertEqual(sorted(r["source_section_ids"]), ["sec:a", "sec:b"])
        self.assertEqual(len(r["candidate_deviations"]), 1)
        self.assertTrue(r["candidate_deviations"][0]["programmable"])

    def test_uses_llm_judges_when_not_injected(self) -> None:
        objs = [
            _step1_obj("sec:a", ["A"], "Rule A", "Requirement A", "Scenario A"),
            _step1_obj("sec:b", ["B"], "Rule A copy", "Requirement A copy", "Scenario B"),
        ]
        with patch(
            "pdcheck_factory.step2_merge._default_rule_duplicate_judge",
            return_value=True,
        ) as rule_mock, patch(
            "pdcheck_factory.step2_merge._default_deviation_duplicate_judge",
            return_value=False,
        ) as dev_mock:
            out = merge_step1_outputs(study_id="study-x", step1_objects=objs)
        self.assertEqual(len(out["rules"]), 1)
        self.assertEqual(len(out["rules"][0]["candidate_deviations"]), 2)
        self.assertGreaterEqual(rule_mock.call_count, 1)
        self.assertGreaterEqual(dev_mock.call_count, 1)


if __name__ == "__main__":
    unittest.main()

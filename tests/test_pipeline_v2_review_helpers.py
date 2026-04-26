from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from pdcheck_factory import pipeline_v2
from pdcheck_factory.json_util import write_json


class PipelineV2ReviewHelpersTests(unittest.TestCase):
    def test_apply_deviation_review_updates_preserves_existing_fields(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp)
            study_id = "study-x"

            write_json(
                output_dir
                / study_id
                / "pipeline"
                / "protocol_index"
                / "paragraph_index.json",
                {
                    "schema_version": "1.0.0",
                    "study_id": study_id,
                    "generated_at": "2026-01-01T00:00:00+00:00",
                    "paragraphs": [{"paragraph_id": "p1", "text": "Protocol text."}],
                },
            )
            write_json(
                output_dir
                / study_id
                / "pipeline"
                / "acrf_summary"
                / "acrf_summary_text_merged.json",
                {
                    "schema_version": "1.0.0",
                    "study_id": study_id,
                    "generated_at": "2026-01-01T00:00:00+00:00",
                    "datasets": [],
                },
            )

            state = {
                "schema_version": "1.0.0",
                "study_id": study_id,
                "generated_at": "2026-01-01T00:00:00+00:00",
                "deviations": [
                    {
                        "deviation_id": "dev-0001",
                        "rule_id": "rule-001",
                        "text": "Old text",
                        "paragraph_refs": ["p1"],
                        "status": "pending",
                        "dm_comment": "",
                        "pseudo_logic": "SELECT 1",
                        "programmable": True,
                    }
                ],
            }
            updates = {
                "dev-0001": {
                    "status": "to_review",
                    "dm_comment": "Please make it explicit",
                }
            }
            with patch(
                "pdcheck_factory.pipeline_v2.revise_text_with_comment",
                return_value=("Updated explicit text", ["p1"]),
            ):
                new_state, audit = pipeline_v2.apply_deviation_review_updates(
                    study_id=study_id,
                    output_dir=output_dir,
                    state_obj=state,
                    updates=updates,
                    run_revision_cycle=True,
                )
            row = new_state["deviations"][0]
            self.assertEqual(row["text"], "Updated explicit text")
            self.assertEqual(row["status"], "to_review")
            self.assertEqual(row["dm_comment"], "Please make it explicit")
            # Field-preserving merge: existing metadata remains.
            self.assertEqual(row["pseudo_logic"], "SELECT 1")
            self.assertTrue(row["programmable"])
            self.assertEqual(audit["updated_rows"], 1)
            self.assertEqual(audit["revised_rows"], 1)

    def test_generate_pseudo_logic_for_deviation_includes_programmability(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp)
            study_id = "study-y"

            write_json(
                output_dir
                / study_id
                / "pipeline"
                / "acrf_summary"
                / "acrf_summary_text_merged.json",
                {
                    "schema_version": "1.0.0",
                    "study_id": study_id,
                    "generated_at": "2026-01-01T00:00:00+00:00",
                    "datasets": [],
                },
            )

            deviation = {
                "deviation_id": "dev-0100",
                "rule_id": "rule-010",
                "text": "Visit outside Day 3-5 window",
                "paragraph_refs": ["p2"],
            }
            rule_by_id = {"rule-010": {"title": "Visit timing"}}

            def _fake_chat_text_repairs(**kwargs):  # type: ignore[no-untyped-def]
                label = kwargs.get("label", "")
                if str(label).startswith("v2-pseudo-"):
                    return "<<<BEGIN_PSEUDO>>>\nPSEUDO_LOGIC: SELECT 1\n<<<END_PSEUDO>>>"
                return "PROGRAMMABLE: yes\nRATIONALE: Date field and window are present."

            with patch(
                "pdcheck_factory.pipeline_v2.llm.chat_text_repairs",
                side_effect=_fake_chat_text_repairs,
            ):
                item = pipeline_v2.generate_pseudo_logic_for_deviation(
                    study_id=study_id,
                    output_dir=output_dir,
                    deviation=deviation,
                    rule_by_id=rule_by_id,
                )
            self.assertEqual(item["deviation_id"], "dev-0100")
            self.assertIn("SELECT 1", item["pseudo_logic"])
            self.assertTrue(item["programmable"])
            self.assertIn("window", item["programmability_note"])


if __name__ == "__main__":
    unittest.main()

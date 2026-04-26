from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from pdcheck_factory import paths
from pdcheck_factory.protocol_markdown import write_manifest
from pdcheck_factory.step2_ui_helpers import (
    build_review_rows_from_ui_updates,
    flatten_step2_rows,
    local_step2_working_merged,
    protocol_referenced_sentences_preview,
    protocol_section_preview,
)


class Step2UiHelpersTests(unittest.TestCase):
    def test_build_review_rows_validates_status(self) -> None:
        out = build_review_rows_from_ui_updates(
            {
                "rule-001::dev-001a": {
                    "rule_id": "rule-001",
                    "deviation_id": "dev-001a",
                    "validation_status": "maybe",
                    "dm_comments": "",
                    "programmable": "",
                }
            }
        )
        self.assertTrue(out["errors"])

    def test_build_review_rows_ok(self) -> None:
        out = build_review_rows_from_ui_updates(
            {
                "rule-001::dev-001a": {
                    "rule_id": "rule-001",
                    "deviation_id": "dev-001a",
                    "validation_status": "to_review",
                    "dm_comments": "Fix wording.",
                    "programmable": "true",
                }
            }
        )
        self.assertFalse(out["errors"])
        self.assertEqual(out["updates"]["rule-001::dev-001a"]["validation_status"], "to_review")

    def test_protocol_preview_joins_raw_fragments(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            output_dir = Path(td) / "out"
            study_id = "s1"
            raw = paths.local_protocol_sections_raw_dir(study_id, output_dir)
            raw.mkdir(parents=True, exist_ok=True)
            (raw / "sec_abc.md").write_text("A", encoding="utf-8")
            (raw / "sec_def.md").write_text("B", encoding="utf-8")
            text = protocol_section_preview(
                study_id=study_id,
                output_dir=output_dir,
                section_ids=["sec:abc", "sec:def"],
            )
            self.assertIn("A", text)
            self.assertIn("B", text)
            self.assertIn("---", text)

    def test_resolve_step2_working_path(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            output_dir = Path(td) / "out"
            study_id = "s1"
            p = local_step2_working_merged(study_id, output_dir)
            self.assertTrue(str(p).endswith("step2_merged.working.json"))

    def test_flatten_step2_rows(self) -> None:
        obj = {
            "rules": [
                {
                    "rule_id": "rule-001",
                    "candidate_deviations": [{"deviation_id": "dev-001a"}],
                }
            ]
        }
        rows = flatten_step2_rows(obj)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["row_key"], "rule-001::dev-001a")

    def test_protocol_referenced_sentences_preview_order_and_lookup(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            output_dir = Path(td) / "out"
            study_id = "s1"
            man_path = paths.local_protocol_sections_manifest(study_id, output_dir)
            man_path.parent.mkdir(parents=True, exist_ok=True)
            write_manifest(
                man_path,
                {
                    "manifest_schema_version": "1.1.0",
                    "study_id": study_id,
                    "sections": [
                        {
                            "section_id": "sec:x",
                            "section_path": ["X"],
                            "sentences": [
                                {"id": "sec:x#s1", "text": "First sentence."},
                                {"id": "sec:x#s2", "text": "Second sentence."},
                            ],
                        }
                    ],
                },
            )
            text = protocol_referenced_sentences_preview(
                study_id=study_id,
                output_dir=output_dir,
                rule_sentence_refs=["sec:x#s2", "sec:x#s1"],
                deviation_sentence_refs=["sec:x#s1"],
            )
            self.assertIn("First sentence.", text)
            self.assertIn("Second sentence.", text)
            self.assertLess(text.index("Second sentence."), text.index("First sentence."))

    def test_protocol_referenced_sentences_preview_unknown_ref(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            output_dir = Path(td) / "out"
            study_id = "s2"
            man_path = paths.local_protocol_sections_manifest(study_id, output_dir)
            man_path.parent.mkdir(parents=True, exist_ok=True)
            write_manifest(
                man_path,
                {
                    "manifest_schema_version": "1.1.0",
                    "study_id": study_id,
                    "sections": [],
                },
            )
            text = protocol_referenced_sentences_preview(
                study_id=study_id,
                output_dir=output_dir,
                rule_sentence_refs=["sec:missing#s1"],
                deviation_sentence_refs=[],
            )
            self.assertIn("not found in manifest", text)


if __name__ == "__main__":
    unittest.main()

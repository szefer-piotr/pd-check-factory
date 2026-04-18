from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from pdcheck_factory import paths
from pdcheck_factory.step2_ui_helpers import (
    build_review_rows_from_ui_updates,
    flatten_step2_rows,
    local_step2_working_merged,
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


class Step2UiFastapiSmokeTests(unittest.TestCase):
    def test_build_app_index_missing_file_404(self) -> None:
        try:
            from fastapi.testclient import TestClient

            from pdcheck_factory.ui_step2_review import build_app
        except ImportError:
            self.skipTest("fastapi not installed (pip install -e '.[ui]')")

        with tempfile.TemporaryDirectory() as td:
            output_dir = Path(td) / "out"
            study_id = "missing-study"
            app = build_app(study_id=study_id, output_dir=output_dir)
            client = TestClient(app)
            r = client.get("/")
            self.assertEqual(r.status_code, 404)


if __name__ == "__main__":
    unittest.main()

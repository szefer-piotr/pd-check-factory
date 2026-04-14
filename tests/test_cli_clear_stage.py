from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from pdcheck_factory.cli import run_clear_stage
from pdcheck_factory import paths


class ClearStageTests(unittest.TestCase):
    def test_clear_stage_step2_removes_all_step2_outputs(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            output_dir = Path(td) / "output"
            study_id = "ini-2004-102"

            targets = [
                paths.local_protocol_sections_step2_merged(study_id, output_dir),
                paths.local_protocol_sections_step2_review_workbook(study_id, output_dir),
                paths.local_protocol_sections_step2_validated(study_id, output_dir),
                paths.local_protocol_sections_step2_validation_audit(study_id, output_dir),
                paths.local_protocol_sections_step2_reviewed_workbook(study_id, output_dir),
            ]

            for p in targets:
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text("x", encoding="utf-8")
                self.assertTrue(p.exists())

            run_clear_stage(
                study_id=study_id,
                stage="step2",
                output_dir=output_dir,
                clear_blob=False,
            )

            for p in targets:
                self.assertFalse(p.exists(), f"Expected removed: {p}")


if __name__ == "__main__":
    unittest.main()

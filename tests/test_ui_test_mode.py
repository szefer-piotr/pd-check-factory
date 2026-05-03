from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from pdcheck_factory import paths, ui_test_mode
from pdcheck_factory.json_util import read_json


class UiTestModeTests(unittest.TestCase):
    def _fixtures_dir(self) -> Path:
        return Path(__file__).resolve().parent / "fixtures" / "ui_v2"

    def test_test_mode_run_steps_writes_expected_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            output_dir = Path(td)
            study_id = "study-test-mode"
            config = ui_test_mode.UiModeConfig(mode="test", fixtures_dir=self._fixtures_dir())
            ui_test_mode.run_steps(
                study_id=study_id,
                output_dir=output_dir,
                from_step=1,
                to_step=5,
                config=config,
            )
            self.assertTrue(paths.local_acrf_summary_text_merged(study_id, output_dir).is_file())
            self.assertTrue(paths.local_protocol_paragraph_index_json(study_id, output_dir).is_file())
            self.assertTrue(paths.local_rules_parsed_json(study_id, output_dir).is_file())
            self.assertTrue(paths.local_deviations_review_state(study_id, output_dir).is_file())
            self.assertTrue(paths.local_deviations_validated_json(study_id, output_dir).is_file())

    def test_test_mode_refine_single_deviation_is_deterministic(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            output_dir = Path(td)
            study_id = "study-refine"
            config = ui_test_mode.UiModeConfig(mode="test", fixtures_dir=self._fixtures_dir())
            row = {
                "deviation_id": "dev-1234",
                "rule_id": "rule-001",
                "text": "Original deviation text",
                "paragraph_refs": ["p1"],
                "status": "to_review",
            }
            updated, audit = ui_test_mode.refine_single_deviation_with_comment(
                study_id=study_id,
                output_dir=output_dir,
                row=row,
                dm_comment="make this explicit",
                run_revision_cycle=True,
                config=config,
            )
            self.assertIn("synthetic revision", updated["text"])
            self.assertEqual(updated["dm_comment"], "make this explicit")
            self.assertEqual(audit["revised_rows"], 1)

    def test_synthetic_extract_and_split_writes_expected_paths(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            output_dir = Path(td)
            study_id = "study-extract"
            config = ui_test_mode.UiModeConfig(mode="test", fixtures_dir=self._fixtures_dir())
            ui_test_mode.write_synthetic_extraction_outputs(study_id, output_dir, config)
            proto = (
                paths.local_extraction_opendataloader(study_id, "protocol", output_dir)
                / "rendered"
                / "source.md"
            )
            acrf = (
                paths.local_extraction_layout(study_id, "acrf", output_dir)
                / "rendered"
                / "source.md"
            )
            self.assertTrue(proto.is_file())
            self.assertTrue(acrf.is_file())
            written, manifest = ui_test_mode.run_split_toc_for_ui(
                study_id=study_id,
                output_dir=output_dir,
                config=config,
            )
            self.assertGreaterEqual(written, 1)
            self.assertTrue(manifest.parent.is_dir())

    def test_mixed_mode_extract_falls_back_to_synthetic(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            output_dir = Path(td)
            study_id = "study-mixed-extract"
            config = ui_test_mode.UiModeConfig(mode="mixed", fixtures_dir=self._fixtures_dir())
            with patch(
                "pdcheck_factory.ui_test_mode.cli.run_extract",
                side_effect=RuntimeError("no cloud"),
            ):
                ui_test_mode.run_extract_for_ui(
                    study_id=study_id,
                    output_dir=output_dir,
                    config=config,
                    protocol_blob=None,
                    acrf_blob=None,
                    model_id=None,
                    sas_ttl=15,
                    upload=True,
                    skip_acrf=False,
                    upload_only=False,
                    run_opendataloader_ocr=True,
                    opendataloader_only=False,
                    debug_blob=False,
                )
            self.assertTrue(
                (
                    paths.local_extraction_opendataloader(study_id, "protocol", output_dir)
                    / "rendered"
                    / "source.md"
                ).is_file()
            )

    def test_mixed_mode_falls_back_to_synthetic_when_run_steps_fails(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            output_dir = Path(td)
            study_id = "study-mixed"
            config = ui_test_mode.UiModeConfig(mode="mixed", fixtures_dir=self._fixtures_dir())
            with patch("pdcheck_factory.ui_test_mode.pipeline_v2.run_steps", side_effect=RuntimeError("boom")):
                ui_test_mode.run_steps(
                    study_id=study_id,
                    output_dir=output_dir,
                    from_step=8,
                    to_step=8,
                    config=config,
                )
            pseudo = read_json(paths.local_pseudo_logic_review_state(study_id, output_dir))
            self.assertEqual(pseudo["study_id"], study_id)
            self.assertTrue(paths.local_pseudo_logic_validated_json(study_id, output_dir).is_file())


if __name__ == "__main__":
    unittest.main()

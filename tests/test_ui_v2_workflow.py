from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from pdcheck_factory import ui_v2_review_streamlit as ui


class UiV2WorkflowTests(unittest.TestCase):
    def test_parse_args_defaults_data_mode_and_fixtures_dir(self) -> None:
        with patch("sys.argv", ["ui_v2_review_streamlit.py", "--study-id", "MY-STUDY"]):
            args = ui._parse_args()
        self.assertEqual(args.study_id, "MY-STUDY")
        self.assertEqual(args.output_dir, "output")
        self.assertEqual(args.data_mode, "real")
        self.assertEqual(args.fixtures_dir, "tests/fixtures/ui_v2")

    def test_parse_args_accepts_test_mode(self) -> None:
        with patch(
            "sys.argv",
            [
                "ui_v2_review_streamlit.py",
                "--study-id",
                "MY-STUDY",
                "--data-mode",
                "test",
                "--fixtures-dir",
                "/tmp/fx",
            ],
        ):
            args = ui._parse_args()
        self.assertEqual(args.data_mode, "test")
        self.assertEqual(args.fixtures_dir, "/tmp/fx")

    def test_contract_status_blocked_when_required_missing(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            required = root / "required.json"
            produced = root / "produced.json"
            contract = {
                "requires": [(required, "file")],
                "produces": [(produced, "file")],
            }
            status, missing = ui._contract_status(contract)
            self.assertEqual(status, "blocked")
            self.assertIn(str(required), missing)

    def test_contract_status_ready_when_prereqs_met_not_produced(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            required = root / "required.json"
            required.write_text("{}", encoding="utf-8")
            produced = root / "produced.json"
            contract = {
                "requires": [(required, "file")],
                "produces": [(produced, "file")],
            }
            status, missing = ui._contract_status(contract)
            self.assertEqual(status, "ready")
            self.assertEqual(missing, [])

    def test_contract_status_complete_when_outputs_exist(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            required = root / "required.json"
            produced = root / "produced.json"
            required.write_text("{}", encoding="utf-8")
            produced.write_text("{}", encoding="utf-8")
            contract = {
                "requires": [(required, "file")],
                "produces": [(produced, "file")],
            }
            status, missing = ui._contract_status(contract)
            self.assertEqual(status, "complete")
            self.assertEqual(missing, [])

    def test_capture_run_collects_stdout_and_success(self) -> None:
        ok, out, err = ui._capture_run(lambda: print("hello"))
        self.assertTrue(ok)
        self.assertIn("hello", out)
        self.assertEqual(err, "")

    def test_capture_run_collects_exception(self) -> None:
        def _boom() -> None:
            print("before error")
            raise ValueError("kaboom")

        ok, out, err = ui._capture_run(_boom)
        self.assertFalse(ok)
        self.assertIn("before error", out)
        self.assertIn("kaboom", err)


if __name__ == "__main__":
    unittest.main()

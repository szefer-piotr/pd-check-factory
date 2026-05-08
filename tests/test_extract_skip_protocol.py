from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


class ExtractSkipProtocolTests(unittest.TestCase):
    def test_run_extract_for_ui_real_passes_skip_protocol(self) -> None:
        captured: dict = {}

        def _fake_run_extract(**kwargs):
            captured.update(kwargs)

        import pdcheck_factory.ui_test_mode as ut

        with tempfile.TemporaryDirectory() as td:
            out = Path(td)
            config = ut.UiModeConfig(mode="real", fixtures_dir=Path("tests/fixtures/ui_v2"))
            with patch.object(ut.cli, "run_extract", side_effect=_fake_run_extract):
                ut.run_extract_for_ui(
                    study_id="S",
                    output_dir=out,
                    config=config,
                    protocol_blob=None,
                    acrf_blob=None,
                    model_id=None,
                    sas_ttl=15,
                    upload=False,
                    skip_acrf=False,
                    skip_protocol=True,
                    upload_only=False,
                    run_opendataloader_ocr=True,
                    opendataloader_only=False,
                    debug_blob=False,
                )
        self.assertTrue(captured.get("skip_protocol"))

if __name__ == "__main__":
    unittest.main()

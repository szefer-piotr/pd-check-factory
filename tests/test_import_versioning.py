"""Tests for versioned import snapshots and active source selection."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from pdcheck_factory import import_grounding, paths, pipeline_v2
from pdcheck_factory.ui_api.service import ENTRY_MODE_IMPORTED_PD_SPEC, UiApiError, UiStepService


class TestImportVersioning(unittest.TestCase):
    def test_apply_active_deviations_source_copies_snapshot(self) -> None:
        study_id = "VER-TEST"
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp)
            snapshot = import_grounding.build_deviations_state(
                study_id=study_id,
                deviations=[
                    {
                        "deviation_id": "dev-import-aaa",
                        "rule_id": "pd-spec-dev-import-aaa",
                        "text": "t",
                        "paragraph_refs": ["p1"],
                        "entry_source": "imported_pd_spec",
                    }
                ],
                import_version="v1",
            )
            snap_path = paths.local_deviations_import_snapshot(study_id, output_dir, "v1")
            snap_path.parent.mkdir(parents=True, exist_ok=True)
            snap_path.write_text(json.dumps(snapshot), encoding="utf-8")

            result = pipeline_v2.apply_active_deviations_source(study_id, output_dir, "import_v1")
            self.assertEqual(result["deviation_count"], 1)

            review = paths.local_deviations_review_state(study_id, output_dir)
            active = json.loads(review.read_text(encoding="utf-8"))
            self.assertEqual(len(active["deviations"]), 1)

    def test_hybrid_mode_allows_extract_after_import_entry_mode(self) -> None:
        """Legacy imported_pd_spec entry mode must not block rule extraction."""
        study_id = "HYBRID-TEST"
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp)
            svc = UiStepService(output_dir=output_dir)
            manifest_path = paths.local_ui_upload_manifest(study_id, output_dir)
            manifest_path.parent.mkdir(parents=True, exist_ok=True)
            manifest_path.write_text(
                json.dumps({"entryMode": ENTRY_MODE_IMPORTED_PD_SPEC, "study_id": study_id}),
                encoding="utf-8",
            )
            index_path = paths.local_protocol_paragraph_index_json(study_id, output_dir)
            index_path.parent.mkdir(parents=True, exist_ok=True)
            index_path.write_text('{"paragraphs": []}', encoding="utf-8")
            with self.assertRaises(UiApiError) as blocked:
                svc.run_step(study_id, "extract-rules")
            self.assertEqual(blocked.exception.code, "STEP_BLOCKED")
            self.assertIn("extract-inputs", blocked.exception.message)


if __name__ == "__main__":
    unittest.main()

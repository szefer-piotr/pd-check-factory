"""Tests for import grounding helpers and pipeline guards."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from pdcheck_factory import import_grounding, paths, pipeline_v2
from pdcheck_factory.pd_spec_import import map_pd_spec_row_to_deviation


class TestImportGrounding(unittest.TestCase):
    def test_retrieve_paragraph_candidates_ranks_overlap(self) -> None:
        index_obj = {
            "paragraphs": [
                {"paragraph_id": "p1", "text": "Inclusion age minimum eighteen years"},
                {"paragraph_id": "p2", "text": "Unrelated laboratory visit window"},
                {"paragraph_id": "p3", "text": "Eligibility age criteria for subjects"},
            ]
        }
        deviation = map_pd_spec_row_to_deviation(
            {
                "protocol_deviation_category": "Eligibility",
                "protocol_deviation_sub_category": "Age",
                "text": "Subject below minimum eligibility age",
            },
            row_index=1,
        )
        candidates = import_grounding.retrieve_paragraph_candidates(
            deviation=deviation,
            index_obj=index_obj,
            top_k=2,
        )
        ids = [p["paragraph_id"] for p in candidates]
        self.assertIn("p1", ids)
        self.assertIn("p3", ids)

    def test_build_deviations_state_schema_version(self) -> None:
        state = import_grounding.build_deviations_state(
            study_id="S1",
            deviations=[],
            import_version="v1",
        )
        self.assertEqual(state["schema_version"], "1.1.0")
        self.assertEqual(state["import_version"], "v1")

    def test_run_import_never_writes_rules_parsed(self) -> None:
        study_id = "IMPORT-TEST"
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp)
            root = paths.local_study_root(study_id, output_dir)
            root.mkdir(parents=True)
            index_path = paths.local_protocol_paragraph_index_json(study_id, output_dir)
            index_path.parent.mkdir(parents=True, exist_ok=True)
            index_path.write_text(
                json.dumps(
                    {
                        "schema_version": "1.0.0",
                        "study_id": study_id,
                        "generated_at": "2026-05-21T00:00:00Z",
                        "paragraphs": [{"paragraph_id": "p1", "text": "Eligibility age minimum"}],
                    }
                ),
                encoding="utf-8",
            )
            acrf_path = paths.local_acrf_summary_text_merged(study_id, output_dir)
            acrf_path.parent.mkdir(parents=True, exist_ok=True)
            acrf_path.write_text(
                json.dumps(
                    {
                        "schema_version": "1.0.0",
                        "study_id": study_id,
                        "generated_at": "2026-05-21T00:00:00Z",
                        "datasets": [{"dataset_name": "DM", "columns": []}],
                    }
                ),
                encoding="utf-8",
            )

            from openpyxl import Workbook
            from io import BytesIO
            from pdcheck_factory.pd_spec_export import PD_SPEC_HEADERS, PD_SPEC_SHEET_TITLE

            wb = Workbook()
            ws = wb.active
            ws.title = PD_SPEC_SHEET_TITLE
            ws.append(PD_SPEC_HEADERS)
            ws.append(["Cat", "Sub", "Deviation text here", "", "", "", "", "", "", "", "", "", ""])
            buf = BytesIO()
            wb.save(buf)
            workbook_path = paths.local_pd_spec_workbook(study_id, output_dir)
            workbook_path.parent.mkdir(parents=True, exist_ok=True)
            workbook_path.write_bytes(buf.getvalue())

            dev = map_pd_spec_row_to_deviation(
                {
                    "protocol_deviation_category": "Cat",
                    "protocol_deviation_sub_category": "Sub",
                    "text": "Deviation text here",
                },
                row_index=1,
            )

            grounded = {
                **dev,
                "paragraph_refs": ["p1"],
                "data_support_note": "DM",
                "status": "pending",
                "pd_spec_import": {
                    **dev.get("pd_spec_import", {}),
                    "grounding_error": "",
                },
            }

            with patch(
                "pdcheck_factory.import_grounding.ground_imported_deviation",
                return_value=grounded,
            ), patch(
                "pdcheck_factory.pipeline_v2.generate_pseudo_logic_for_imported_deviation",
                return_value={
                    "deviation_id": dev["deviation_id"],
                    "rule_id": dev["rule_id"],
                    "rule_title": "Cat / Sub",
                    "pseudo_logic": "SELECT 1",
                    "manual_or_programmable": "Programmable",
                    "programmable": True,
                    "programmability_note": "ok",
                    "status": "pending",
                    "dm_comment": "",
                },
            ):
                pipeline_v2.run_import_pd_spec_grounding(study_id, output_dir)

            rules_path = paths.local_rules_parsed_json(study_id, output_dir)
            self.assertFalse(rules_path.exists())

            snapshot = paths.local_deviations_import_snapshot(study_id, output_dir, "v1")
            self.assertTrue(snapshot.exists())
            review = paths.local_deviations_review_state(study_id, output_dir)
            self.assertTrue(review.exists())
            pseudo_review = paths.local_pseudo_logic_review_state(study_id, output_dir)
            self.assertTrue(pseudo_review.exists())


if __name__ == "__main__":
    unittest.main()

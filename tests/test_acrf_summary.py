from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from pdcheck_factory.cli import run_acrf_merge_summaries
from pdcheck_factory.json_util import read_json, write_json
from pdcheck_factory import paths


def _section_summary(*, study_id: str, section_id: str, dataset_name: str, column_name: str) -> dict:
    return {
        "schema_version": "1.0.0",
        "study_id": study_id,
        "generated_at": "2026-01-01T00:00:00+00:00",
        "acrf_section_id": section_id,
        "acrf_section_path": [section_id],
        "datasets": [
            {
                "dataset_name": dataset_name,
                "columns": [
                    {
                        "column_name": column_name,
                        "variable_type": "categorical",
                        "categorical_values": ["YES", "NO"],
                        "value_range": {"min": "", "max": ""},
                        "notes": "",
                    }
                ],
            }
        ],
    }


class AcrfSummaryTests(unittest.TestCase):
    def test_merge_summaries_builds_dataset_index(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            output_dir = Path(td) / "output"
            study_id = "study-x"
            sections_dir = paths.local_acrf_summary_sections_dir(study_id, output_dir)
            sections_dir.mkdir(parents=True, exist_ok=True)

            write_json(
                paths.local_acrf_summary_section(study_id, "acrf:sec1", output_dir),
                _section_summary(
                    study_id=study_id,
                    section_id="acrf:sec1",
                    dataset_name="DM",
                    column_name="AGE",
                ),
            )
            write_json(
                paths.local_acrf_summary_section(study_id, "acrf:sec2", output_dir),
                _section_summary(
                    study_id=study_id,
                    section_id="acrf:sec2",
                    dataset_name="DM",
                    column_name="SEX",
                ),
            )

            merged_path = run_acrf_merge_summaries(
                study_id=study_id,
                output_dir=output_dir,
                upload=False,
            )
            merged = read_json(merged_path)
            self.assertEqual(merged["schema_version"], "1.0.0")
            self.assertEqual(len(merged["section_summaries"]), 2)
            self.assertEqual(len(merged["dataset_index"]), 1)
            dm = merged["dataset_index"][0]
            self.assertEqual(dm["dataset_name"], "DM")
            self.assertEqual(dm["column_names"], ["AGE", "SEX"])
            self.assertEqual(dm["source_section_ids"], ["acrf:sec1", "acrf:sec2"])


if __name__ == "__main__":
    unittest.main()

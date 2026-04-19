from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from pdcheck_factory import paths
from pdcheck_factory.cli import run_protocol_sections_extract, run_step2_merge
from pdcheck_factory.protocol_markdown import write_manifest


def _minimal_step1_section(study_id: str, section_id: str) -> dict:
    return {
        "schema_version": "2.0.1",
        "study_id": study_id,
        "generated_at": "2026-01-01T00:00:00+00:00",
        "section_id": section_id,
        "section_path": ["X"],
        "rules": [
            {
                "rule_id": "R1",
                "title": "t",
                "atomic_requirement": "r",
                "sentence_refs": [f"{section_id}#s1"],
                "candidate_deviations": [
                    {
                        "deviation_id": "D1",
                        "scenario_description": "s",
                        "example_violation_narrative": "e",
                        "sentence_refs": [f"{section_id}#s1"],
                        "programmable": True,
                        "pseudo_sql_logic": "SELECT 1",
                    }
                ],
            }
        ],
    }


class CliOverwriteTests(unittest.TestCase):
    def test_extract_overwrite_true_removes_orphan_step1_json(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            output_dir = Path(td) / "output"
            study_id = "s-overwrite"
            manifest_path = paths.local_protocol_sections_manifest(study_id, output_dir)
            manifest_path.parent.mkdir(parents=True, exist_ok=True)
            write_manifest(
                manifest_path,
                {
                    "manifest_schema_version": "1.1.0",
                    "study_id": study_id,
                    "sections": [
                        {
                            "section_id": "sec:abc",
                            "section_path": ["A"],
                            "heading_level": 1,
                            "body_markdown": "x",
                            "sentences": [{"id": "sec:abc#s1", "text": "One."}],
                        }
                    ],
                },
            )
            step1_dir = paths.local_protocol_sections_step1_dir(study_id, output_dir)
            step1_dir.mkdir(parents=True, exist_ok=True)
            orphan = step1_dir / "orphan.json"
            orphan.write_text('{"stale": true}', encoding="utf-8")

            out_obj = _minimal_step1_section(study_id, "sec:abc")
            with patch(
                "pdcheck_factory.cli._load_acrf_contexts",
                return_value=(None, None),
            ), patch(
                "pdcheck_factory.llm.extract_protocol_section_step1",
                return_value=out_obj,
            ):
                run_protocol_sections_extract(
                    study_id=study_id,
                    output_dir=output_dir,
                    upload=False,
                    all_sections=True,
                    section_id=[],
                    match_regex=None,
                    skip_section_id=[],
                    skip_regex=None,
                    include_acrf=False,
                    use_acrf_summary=False,
                    overwrite=True,
                )

            self.assertFalse(orphan.exists())
            written = step1_dir / "sec_abc.json"
            self.assertTrue(written.is_file())

    def test_extract_overwrite_false_keeps_orphan(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            output_dir = Path(td) / "output"
            study_id = "s-keep"
            manifest_path = paths.local_protocol_sections_manifest(study_id, output_dir)
            manifest_path.parent.mkdir(parents=True, exist_ok=True)
            write_manifest(
                manifest_path,
                {
                    "manifest_schema_version": "1.1.0",
                    "study_id": study_id,
                    "sections": [
                        {
                            "section_id": "sec:abc",
                            "section_path": ["A"],
                            "heading_level": 1,
                            "body_markdown": "x",
                            "sentences": [{"id": "sec:abc#s1", "text": "One."}],
                        }
                    ],
                },
            )
            step1_dir = paths.local_protocol_sections_step1_dir(study_id, output_dir)
            step1_dir.mkdir(parents=True, exist_ok=True)
            orphan = step1_dir / "orphan.json"
            orphan.write_text('{"stale": true}', encoding="utf-8")

            out_obj = _minimal_step1_section(study_id, "sec:abc")
            with patch(
                "pdcheck_factory.cli._load_acrf_contexts",
                return_value=(None, None),
            ), patch(
                "pdcheck_factory.llm.extract_protocol_section_step1",
                return_value=out_obj,
            ):
                run_protocol_sections_extract(
                    study_id=study_id,
                    output_dir=output_dir,
                    upload=False,
                    all_sections=True,
                    section_id=[],
                    match_regex=None,
                    skip_section_id=[],
                    skip_regex=None,
                    include_acrf=False,
                    use_acrf_summary=False,
                    overwrite=False,
                )

            self.assertTrue(orphan.exists())

    def test_step2_merge_overwrite_true_clears_prior_step2_dir(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            output_dir = Path(td) / "output"
            study_id = "s2w"
            step1_dir = paths.local_protocol_sections_step1_dir(study_id, output_dir)
            step1_dir.mkdir(parents=True, exist_ok=True)
            step1_path = step1_dir / "sec_x.json"
            step1_path.write_text(
                json.dumps(_minimal_step1_section(study_id, "sec:x")),
                encoding="utf-8",
            )

            step2_dir = paths.local_pipeline_step2_dir(study_id, output_dir)
            step2_dir.mkdir(parents=True, exist_ok=True)
            junk = step2_dir / "stale_marker.txt"
            junk.write_text("old", encoding="utf-8")

            merged = {
                "schema_version": "2.1.1",
                "study_id": study_id,
                "generated_at": "2026-01-01T00:00:00+00:00",
                "rules": [],
            }
            with patch(
                "pdcheck_factory.cli._load_acrf_contexts",
                return_value=(None, None),
            ), patch(
                "pdcheck_factory.cli.step2_merge.merge_step1_outputs",
                return_value=merged,
            ):
                out = run_step2_merge(
                    study_id=study_id,
                    output_dir=output_dir,
                    upload=False,
                    use_acrf_summary=False,
                    overwrite=True,
                )

            self.assertFalse(junk.exists())
            self.assertTrue(out.is_file())
            body = json.loads(out.read_text(encoding="utf-8"))
            self.assertEqual(body["schema_version"], "2.1.1")


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import unittest
from pathlib import Path

from pdcheck_factory import paths, study_artifact_sync


class StudyArtifactSyncMappingTests(unittest.TestCase):
    def test_manifest_and_run_state_blob_paths(self) -> None:
        tmp = Path("/tmp/pdcheck-test-output")
        study = "MY-STUDY"
        root = paths.local_study_root(study, tmp)
        manifest = root / "ui_upload_manifest.json"
        run_state = root / "ui_pipeline_run_state.json"
        self.assertEqual(
            study_artifact_sync.local_path_to_blob_path(study, tmp, manifest),
            paths.ui_upload_manifest_blob(study),
        )
        self.assertEqual(
            study_artifact_sync.local_path_to_blob_path(study, tmp, run_state),
            f"pipeline/{study}/ui_pipeline_run_state.json",
        )

    def test_extractions_and_pipeline_tails(self) -> None:
        tmp = Path("/tmp/pdcheck-test-output2")
        study = "S1"
        root = paths.local_study_root(study, tmp)
        choice = root / "extractions" / "ui_extractor_choice.json"
        rules = root / "pipeline" / "rules" / "rules_parsed.json"
        self.assertEqual(
            study_artifact_sync.local_path_to_blob_path(study, tmp, choice),
            f"extractions/{study}/ui_extractor_choice.json",
        )
        self.assertEqual(
            study_artifact_sync.local_path_to_blob_path(study, tmp, rules),
            f"pipeline/{study}/rules/rules_parsed.json",
        )

    def test_blob_to_local_roundtrip_manifest(self) -> None:
        tmp = Path("/tmp/pdcheck-test-output3")
        study = "S2"
        blob = paths.ui_upload_manifest_blob(study)
        local_p = study_artifact_sync.blob_path_to_local_path(study, tmp, blob)
        self.assertEqual(local_p, paths.local_study_root(study, tmp) / "ui_upload_manifest.json")


if __name__ == "__main__":
    unittest.main()

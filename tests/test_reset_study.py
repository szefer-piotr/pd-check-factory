"""Tests for per-study reset API."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from pdcheck_factory import paths
from pdcheck_factory.ui_api.service import UiStepService


def test_reset_study_clears_artifacts_keeps_manifest(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    service = UiStepService(output_dir=tmp_path)
    study_id = "RESET-ME"

    monkeypatch.setattr("pdcheck_factory.blob_io.blob_service_from_env", lambda: object())
    monkeypatch.setattr("pdcheck_factory.blob_io.container_from_env", lambda: "container")
    monkeypatch.setattr("pdcheck_factory.blob_io.upload_blob_bytes", lambda **_kwargs: None)
    monkeypatch.setattr(service, "_study_exists", lambda _sid: False)

    service.create_study(study_id)

    rules_path = paths.local_rules_parsed_json(study_id, tmp_path)
    rules_path.parent.mkdir(parents=True, exist_ok=True)
    rules_path.write_text('{"rules": []}', encoding="utf-8")

    manifest_path = paths.local_ui_upload_manifest(study_id, tmp_path)
    assert manifest_path.is_file()

    deleted: list[str] = []

    def fake_delete(**kwargs):  # type: ignore[no-untyped-def]
        deleted.extend(kwargs.get("blob_paths", []))
        return len(kwargs.get("blob_paths", []))

    monkeypatch.setattr("pdcheck_factory.blob_io.blob_service_from_env", lambda: object())
    monkeypatch.setattr("pdcheck_factory.blob_io.container_from_env", lambda: "container")
    monkeypatch.setattr(
        "pdcheck_factory.blob_io.list_blob_names_with_prefix",
        lambda **_kwargs: ["pipeline/RESET-ME/ui_upload_manifest.json"],
    )
    monkeypatch.setattr("pdcheck_factory.blob_io.delete_blobs", fake_delete)
    monkeypatch.setattr(
        "pdcheck_factory.blob_io.purge_blobs_with_prefix",
        lambda **_kwargs: 0,
    )

    result = service.reset_study(study_id)
    assert result["studyId"] == study_id
    assert result["localOutputRemoved"] is True
    assert not rules_path.is_file()
    assert manifest_path.is_file()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest.get("workflowChoice") == "extract"
    assert manifest.get("pipelineUiStep") == "study"

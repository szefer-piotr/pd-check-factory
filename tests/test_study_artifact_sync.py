from datetime import datetime, timezone
from pathlib import Path

import pytest
from azure.core.exceptions import ResourceNotFoundError

from pdcheck_factory import blob_io, study_artifact_sync


def test_is_missing_blob_error_detects_resource_not_found() -> None:
    assert study_artifact_sync._is_missing_blob_error(ResourceNotFoundError("missing")) is True


def test_is_missing_blob_error_detects_message() -> None:
    assert study_artifact_sync._is_missing_blob_error(Exception("ErrorCode:BlobNotFound")) is True


def test_sync_study_skips_missing_blob_download(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    study_id = "MISSING-BLOB"
    blob_name = f"pipeline/{study_id}/rules/rules_parsed.json"
    blob_item = blob_io.BlobItem(
        name=blob_name,
        last_modified=datetime.now(timezone.utc),
        size=12,
    )

    monkeypatch.setattr(
        study_artifact_sync,
        "_collect_blob_items",
        lambda **_kwargs: {blob_item.name: blob_item},
    )
    monkeypatch.setattr(study_artifact_sync, "iter_tracked_local_files", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(study_artifact_sync.blob_io, "blob_exists", lambda **_kwargs: False)

    def fail_download(**_kwargs):
        raise AssertionError("download_file should not be called when blob_exists is false")

    monkeypatch.setattr(study_artifact_sync.blob_io, "download_file", fail_download)

    report = study_artifact_sync.sync_study(
        study_id,
        tmp_path,
        blob_service=object(),
        container_name="test-container",
    )
    assert report.skipped == 1
    assert report.errors == 0
    assert report.downloaded == 0

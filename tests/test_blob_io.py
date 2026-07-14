from unittest.mock import MagicMock

from pdcheck_factory import blob_io


def test_list_study_ids_excludes_soft_deleted_by_default() -> None:
    container_client = MagicMock()
    container_client.walk_blobs.return_value = [
        MagicMock(prefix="raw/STUDY-A/", name=None),
    ]
    blob_service = MagicMock()
    blob_service.get_container_client.return_value = container_client

    study_ids = blob_io.list_study_ids_from_container(
        blob_service=blob_service,
        container_name="container",
    )

    assert study_ids == ["STUDY-A"]
    _, kwargs = container_client.walk_blobs.call_args
    assert "include" not in kwargs


def test_purge_blobs_deletes_without_undelete() -> None:
    active = MagicMock(deleted=False)
    active.name = "pipeline/STUDY-A/ui_upload_manifest.json"
    deleted = MagicMock(deleted=True)
    deleted.name = "pipeline/STUDY-A/old.json"
    container_client = MagicMock()
    container_client.list_blobs.return_value = [active, deleted]
    blob_client = MagicMock()
    container_client.get_blob_client.return_value = blob_client
    blob_service = MagicMock()
    blob_service.get_container_client.return_value = container_client

    purged = blob_io.purge_blobs_with_prefix(
        blob_service=blob_service,
        container_name="container",
        prefix="pipeline/STUDY-A/",
    )

    assert purged == 2
    assert blob_client.delete_blob.call_count == 2
    undelete = getattr(blob_client, "undelete", None) or getattr(blob_client, "undelete_blob", None)
    if undelete is not None:
        undelete.assert_not_called()

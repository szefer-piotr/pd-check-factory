"""Mirror study artifacts between local ``output/<study_id>/`` and Azure Blob."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

from azure.storage.blob import BlobServiceClient

from pdcheck_factory import blob_io, paths

logger = logging.getLogger(__name__)

SYNC_TOLERANCE_SEC = 1.0


@dataclass
class SyncReport:
    uploaded: int = 0
    downloaded: int = 0
    skipped: int = 0
    errors: int = 0
    error_messages: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "uploaded": self.uploaded,
            "downloaded": self.downloaded,
            "skipped": self.skipped,
            "errors": self.errors,
            "errorMessages": list(self.error_messages[:50]),
        }


def local_study_root_resolved(study_id: str, output_dir: Path) -> Path:
    return paths.local_study_root(study_id, output_dir).resolve()


def local_path_to_blob_path(study_id: str, output_dir: Path, local_path: Path) -> Optional[str]:
    """Map a file under ``output/<study_id>/`` to its blob name, or None if out of scope."""
    root = local_study_root_resolved(study_id, output_dir)
    try:
        rel = local_path.resolve().relative_to(root)
    except ValueError:
        return None
    rel_posix = rel.as_posix()
    if rel_posix == "ui_upload_manifest.json":
        return paths.ui_upload_manifest_blob(study_id)
    if rel_posix == "ui_pipeline_run_state.json":
        return f"pipeline/{study_id}/ui_pipeline_run_state.json"
    if rel_posix.startswith("extractions/"):
        tail = rel_posix[len("extractions/") :]
        return f"extractions/{study_id}/{tail}"
    if rel_posix.startswith("pipeline/"):
        tail = rel_posix[len("pipeline/") :]
        return f"pipeline/{study_id}/{tail}"
    if rel_posix.startswith("review/"):
        tail = rel_posix[len("review/") :]
        return f"review/{study_id}/{tail}"
    return None


def blob_path_to_local_path(study_id: str, output_dir: Path, blob_name: str) -> Optional[Path]:
    """Map a blob name under sync prefixes to a local path."""
    root = local_study_root_resolved(study_id, output_dir)
    manifest_blob = paths.ui_upload_manifest_blob(study_id)
    if blob_name == manifest_blob:
        return root / "ui_upload_manifest.json"
    run_state_blob = f"pipeline/{study_id}/ui_pipeline_run_state.json"
    if blob_name == run_state_blob:
        return root / "ui_pipeline_run_state.json"
    prefix_p = f"pipeline/{study_id}/"
    prefix_e = f"extractions/{study_id}/"
    prefix_r = f"review/{study_id}/"
    if blob_name.startswith(prefix_p):
        tail = blob_name[len(prefix_p) :]
        return root / "pipeline" / tail
    if blob_name.startswith(prefix_e):
        tail = blob_name[len(prefix_e) :]
        return root / "extractions" / tail
    if blob_name.startswith(prefix_r):
        tail = blob_name[len(prefix_r) :]
        return root / "review" / tail
    return None


def _local_mtime_utc(path: Path) -> datetime:
    ts = path.stat().st_mtime
    return datetime.fromtimestamp(ts, tz=timezone.utc)


def _should_skip_by_time(local_dt: datetime, blob_dt: datetime) -> bool:
    return abs((local_dt - blob_dt).total_seconds()) <= SYNC_TOLERANCE_SEC


def mirror_upload_path(
    study_id: str,
    output_dir: Path,
    local_path: Path,
    *,
    blob_service: Optional[BlobServiceClient] = None,
    container_name: Optional[str] = None,
) -> bool:
    """Upload a single local file to its mirrored blob path. Returns False on skip/error."""
    blob_path = local_path_to_blob_path(study_id, output_dir, local_path)
    if not blob_path or not local_path.is_file():
        return False
    try:
        bs = blob_service or blob_io.blob_service_from_env()
        container = container_name or blob_io.container_from_env()
        blob_io.upload_file(
            blob_service=bs,
            container_name=container,
            blob_path=blob_path,
            local_path=local_path,
        )
        return True
    except Exception as exc:  # noqa: BLE001
        logger.warning("Blob mirror upload failed for %s: %s", local_path, exc)
        return False


def mirror_upload_directory(
    study_id: str,
    output_dir: Path,
    directory: Path,
    *,
    blob_service: Optional[BlobServiceClient] = None,
    container_name: Optional[str] = None,
) -> int:
    """Upload every file under ``directory`` that maps to a blob path. Returns upload count."""
    if not directory.is_dir():
        return 0
    count = 0
    for path in sorted(directory.rglob("*")):
        if path.is_file():
            if mirror_upload_path(study_id, output_dir, path, blob_service=blob_service, container_name=container_name):
                count += 1
    return count


def iter_tracked_local_files(study_id: str, output_dir: Path) -> List[Path]:
    """Enumerate local files that participate in blob sync."""
    root = paths.local_study_root(study_id, output_dir)
    out: List[Path] = []
    for name in ("ui_upload_manifest.json", "ui_pipeline_run_state.json"):
        p = root / name
        if p.is_file():
            out.append(p.resolve())
    for sub in ("extractions", "pipeline", "review"):
        d = root / sub
        if d.is_dir():
            for f in d.rglob("*"):
                if f.is_file():
                    out.append(f.resolve())
    return sorted(set(out))


def _collect_blob_items(
    *,
    blob_service: BlobServiceClient,
    container_name: str,
    study_id: str,
) -> Dict[str, blob_io.BlobItem]:
    merged: Dict[str, blob_io.BlobItem] = {}
    for prefix in (
        f"extractions/{study_id}/",
        f"pipeline/{study_id}/",
        f"review/{study_id}/",
    ):
        for item in blob_io.list_blobs_with_properties(
            blob_service=blob_service,
            container_name=container_name,
            prefix=prefix,
        ):
            merged[item.name] = item
    return merged


def sync_study(
    study_id: str,
    output_dir: Path,
    *,
    blob_service: Optional[BlobServiceClient] = None,
    container_name: Optional[str] = None,
) -> SyncReport:
    """
    Bidirectional sync: for each tracked file, newer side wins (1s tolerance).
    Does not delete orphans on either side.
    """
    report = SyncReport()
    bs = blob_service or blob_io.blob_service_from_env()
    container = container_name or blob_io.container_from_env()

    blob_by_name = _collect_blob_items(blob_service=bs, container_name=container, study_id=study_id)
    local_files = iter_tracked_local_files(study_id, output_dir)

    blob_keys: Set[str] = set(blob_by_name.keys())
    for lp in local_files:
        bp = local_path_to_blob_path(study_id, output_dir, lp)
        if bp:
            blob_keys.add(bp)

    for blob_name in sorted(blob_keys):
        local_p = blob_path_to_local_path(study_id, output_dir, blob_name)
        if local_p is None:
            report.errors += 1
            report.error_messages.append(f"No local mapping for blob {blob_name!r}")
            continue

        blob_item = blob_by_name.get(blob_name)
        local_exists = local_p.is_file()

        try:
            if blob_item is None and local_exists:
                blob_io.upload_file(
                    blob_service=bs,
                    container_name=container,
                    blob_path=blob_name,
                    local_path=local_p,
                )
                report.uploaded += 1
            elif blob_item is not None and not local_exists:
                blob_io.download_file(
                    blob_service=bs,
                    container_name=container,
                    blob_path=blob_name,
                    local_path=local_p,
                )
                report.downloaded += 1
            elif blob_item is not None and local_exists:
                local_dt = _local_mtime_utc(local_p)
                if _should_skip_by_time(local_dt, blob_item.last_modified):
                    report.skipped += 1
                elif local_dt > blob_item.last_modified:
                    blob_io.upload_file(
                        blob_service=bs,
                        container_name=container,
                        blob_path=blob_name,
                        local_path=local_p,
                    )
                    report.uploaded += 1
                else:
                    blob_io.download_file(
                        blob_service=bs,
                        container_name=container,
                        blob_path=blob_name,
                        local_path=local_p,
                    )
                    report.downloaded += 1
        except Exception as exc:  # noqa: BLE001
            report.errors += 1
            msg = f"{blob_name}: {exc}"
            report.error_messages.append(msg)
            logger.warning("sync_study: %s", msg)

    return report

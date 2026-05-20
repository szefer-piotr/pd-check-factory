"""Azure Blob Storage helpers (SAS, upload, download)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List, Optional

from azure.core.exceptions import HttpResponseError, ResourceNotFoundError
from azure.storage.blob import (
    BlobSasPermissions,
    BlobServiceClient,
    ContentSettings,
    generate_blob_sas,
)


def require_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise ValueError(
            f"Missing required configuration: {name}. "
            "Set it in your environment or in the `.env` file."
        )
    return value


def _int_from_env(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or not str(raw).strip():
        return default
    return int(str(raw).strip())


def parse_connection_string(connection_string: str) -> Dict[str, str]:
    parts = [p for p in connection_string.split(";") if p.strip()]
    kv: Dict[str, str] = {}
    for p in parts:
        k, v = p.split("=", 1)
        kv[k.strip()] = v.strip()
    return kv


def blob_service_from_env() -> BlobServiceClient:
    """
    Build a BlobServiceClient with HTTP timeouts suitable for large uploads.

    The Azure SDK defaults are connection_timeout=20s and read_timeout=60s; a
    single Put Blob for ``analyze_result.json`` can exceed the read timeout
    while the service processes a multi‑MB body, surfacing as
    ``TimeoutError: The write operation timed out`` from urllib3 even on
    otherwise healthy networks. Override via env if needed.
    """
    cs = require_env("STORAGE_CONNECTION_STRING")
    connect_s = _int_from_env("AZURE_BLOB_CONNECTION_TIMEOUT_SEC", 60)
    read_s = _int_from_env("AZURE_BLOB_READ_TIMEOUT_SEC", 600)
    max_single_mb = _int_from_env("AZURE_BLOB_MAX_SINGLE_PUT_MB", 8)
    max_single_put_size = max(1, max_single_mb) * 1024 * 1024
    # max_single_put_size must be set on the client: passing it to upload_blob()
    # is not stripped by the SDK and is forwarded to urllib3 as a bogus kwarg.
    return BlobServiceClient.from_connection_string(
        cs,
        connection_timeout=connect_s,
        read_timeout=read_s,
        max_single_put_size=max_single_put_size,
    )


def container_from_env() -> str:
    return require_env("STORAGE_CONTAINER")


def generate_read_sas_url(
    *,
    storage_connection_string: str,
    container_name: str,
    blob_path: str,
    ttl_minutes: int = 15,
) -> str:
    cs = parse_connection_string(storage_connection_string)
    account_name = cs.get("AccountName")
    account_key = cs.get("AccountKey")
    endpoint_suffix = cs.get("EndpointSuffix", "core.windows.net")

    if not account_name or not account_key:
        raise ValueError(
            "STORAGE_CONNECTION_STRING must include AccountName and AccountKey."
        )

    blob_name = blob_path.lstrip("/")
    container_prefix = f"{container_name}/"
    if blob_name.startswith(container_prefix):
        blob_name = blob_name[len(container_prefix) :]

    now = datetime.now(timezone.utc)
    start = now - timedelta(minutes=1)
    expiry = now + timedelta(minutes=ttl_minutes)

    sas_token = generate_blob_sas(
        account_name=account_name,
        container_name=container_name,
        blob_name=blob_name,
        account_key=account_key,
        permission=BlobSasPermissions(read=True),
        start=start,
        expiry=expiry,
    )

    return (
        f"https://{account_name}.blob.{endpoint_suffix}/{container_name}/"
        f"{blob_name}?{sas_token}"
    )


def upload_blob_bytes(
    *,
    blob_service: BlobServiceClient,
    container_name: str,
    blob_path: str,
    data: bytes,
    content_type: str,
    debug: bool = False,
) -> None:
    blob_name = blob_path.lstrip("/")
    container_client = blob_service.get_container_client(container_name)
    blob_client = container_client.get_blob_client(blob_name)
    blob_client.upload_blob(
        data,
        overwrite=True,
        content_settings=ContentSettings(content_type=content_type),
    )
    if debug:
        print(
            f"[debug-blob] wrote blob {container_name}/{blob_name} "
            f"({len(data)} bytes, {content_type})"
        )


def download_blob_bytes(
    *,
    blob_service: BlobServiceClient,
    container_name: str,
    blob_path: str,
) -> bytes:
    blob_name = blob_path.lstrip("/")
    container_client = blob_service.get_container_client(container_name)
    blob_client = container_client.get_blob_client(blob_name)
    return blob_client.download_blob().readall()


def blob_exists(
    *,
    blob_service: BlobServiceClient,
    container_name: str,
    blob_path: str,
) -> bool:
    blob_name = blob_path.lstrip("/")
    container_client = blob_service.get_container_client(container_name)
    blob_client = container_client.get_blob_client(blob_name)
    try:
        blob_client.get_blob_properties()
        return True
    except ResourceNotFoundError:
        return False


def account_name_from_connection_string(connection_string: str) -> Optional[str]:
    parsed = parse_connection_string(connection_string)
    return parsed.get("AccountName")


def container_exists(
    *, blob_service: BlobServiceClient, container_name: str
) -> bool:
    container_client = blob_service.get_container_client(container_name)
    try:
        container_client.get_container_properties()
        return True
    except ResourceNotFoundError:
        return False
    except HttpResponseError as ex:
        if ex.status_code == 404:
            return False
        raise


def list_blob_names_with_prefix(
    *,
    blob_service: BlobServiceClient,
    container_name: str,
    prefix: str,
) -> List[str]:
    """List blob names in the container whose paths start with ``prefix``."""
    container_client = blob_service.get_container_client(container_name)
    prefix = prefix.lstrip("/")
    names: List[str] = []
    for blob in container_client.list_blobs(name_starts_with=prefix):
        names.append(blob.name)
    return sorted(names)


@dataclass(frozen=True)
class BlobItem:
    """Minimal blob listing row for sync decisions."""

    name: str
    last_modified: datetime
    size: int


def list_blobs_with_properties(
    *,
    blob_service: BlobServiceClient,
    container_name: str,
    prefix: str,
) -> List[BlobItem]:
    """List blobs under ``prefix`` with last-modified time and size (files only)."""
    container_client = blob_service.get_container_client(container_name)
    prefix = prefix.lstrip("/")
    out: List[BlobItem] = []
    for blob in container_client.list_blobs(name_starts_with=prefix):
        props = blob
        lm = getattr(props, "last_modified", None) or datetime.now(timezone.utc)
        if lm.tzinfo is None:
            lm = lm.replace(tzinfo=timezone.utc)
        else:
            lm = lm.astimezone(timezone.utc)
        size = int(getattr(props, "size", 0) or 0)
        out.append(BlobItem(name=str(props.name), last_modified=lm, size=size))
    return sorted(out, key=lambda b: b.name)


def guess_content_type(file_path: Path) -> str:
    suffix = file_path.suffix.lower()
    mapping = {
        ".json": "application/json",
        ".md": "text/markdown",
        ".txt": "text/plain",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".pdf": "application/pdf",
        ".html": "text/html",
        ".xml": "application/xml",
    }
    return mapping.get(suffix, "application/octet-stream")


def upload_file(
    *,
    blob_service: BlobServiceClient,
    container_name: str,
    blob_path: str,
    local_path: Path,
    content_type: str | None = None,
    debug: bool = False,
) -> None:
    """Read ``local_path`` and upload to ``blob_path``."""
    data = local_path.read_bytes()
    ct = content_type or guess_content_type(local_path)
    upload_blob_bytes(
        blob_service=blob_service,
        container_name=container_name,
        blob_path=blob_path,
        data=data,
        content_type=ct,
        debug=debug,
    )


def download_file(
    *,
    blob_service: BlobServiceClient,
    container_name: str,
    blob_path: str,
    local_path: Path,
) -> None:
    """Download blob bytes into ``local_path`` (creates parent directories)."""
    data = download_blob_bytes(
        blob_service=blob_service,
        container_name=container_name,
        blob_path=blob_path,
    )
    local_path.parent.mkdir(parents=True, exist_ok=True)
    local_path.write_bytes(data)


def describe_blob(
    *,
    blob_service: BlobServiceClient,
    container_name: str,
    blob_path: str,
) -> Optional[str]:
    """Return a short human-readable line for a blob, or None if missing."""
    blob_name = blob_path.lstrip("/")
    container_client = blob_service.get_container_client(container_name)
    blob_client = container_client.get_blob_client(blob_name)
    try:
        props = blob_client.get_blob_properties()
        size = props.size
        return f"{blob_name} ({size} bytes)"
    except ResourceNotFoundError:
        return None


def delete_blobs(
    *,
    blob_service: BlobServiceClient,
    container_name: str,
    blob_paths: List[str],
) -> int:
    """Delete blobs by exact paths. Returns number successfully deleted."""
    container_client = blob_service.get_container_client(container_name)
    deleted = 0
    for path in blob_paths:
        blob_name = path.lstrip("/")
        blob_client = container_client.get_blob_client(blob_name)
        try:
            blob_client.delete_blob()
            deleted += 1
        except ResourceNotFoundError:
            continue
    return deleted

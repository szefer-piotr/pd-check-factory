import argparse
import json
import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from dotenv import load_dotenv

from azure.ai.documentintelligence import DocumentIntelligenceClient
from azure.core.credentials import AzureKeyCredential
from azure.storage.blob import (
    BlobSasPermissions,
    BlobServiceClient,
    ContentSettings,
    generate_blob_sas,
)


def _parse_connection_string(connection_string: str) -> Dict[str, str]:
    # Connection strings are semicolon-delimited key=value pairs.
    parts = [p for p in connection_string.split(";") if p.strip()]
    kv: Dict[str, str] = {}
    for p in parts:
        k, v = p.split("=", 1)
        kv[k.strip()] = v.strip()
    return kv


def _require_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise ValueError(
            f"Missing required configuration: {name}. "
            f"Set it in your environment or in the `.env` file."
        )
    return value


def _generate_read_sas_url(
    *,
    storage_connection_string: str,
    container_name: str,
    blob_path: str,
    ttl_minutes: int = 15,
) -> str:
    cs = _parse_connection_string(storage_connection_string)
    account_name = cs.get("AccountName")
    account_key = cs.get("AccountKey")
    endpoint_suffix = cs.get("EndpointSuffix", "core.windows.net")

    if not account_name or not account_key:
        raise ValueError(
            "STORAGE_CONNECTION_STRING must include AccountName and AccountKey."
        )

    # Make sure we have a blob name relative to the container.
    blob_name = blob_path.lstrip("/")
    container_prefix = f"{container_name}/"
    if blob_name.startswith(container_prefix):
        # Some users paste paths that include the container name (e.g. "container/blob.pdf").
        # The DI URL must reference "blob.pdf" relative to the container.
        stripped = blob_name[len(container_prefix) :]
        print(
            f"Note: BLOB_PATH included the container prefix; using blob name '{stripped}'."
        )
        blob_name = stripped

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


def _as_serializable_dict(result: Any) -> Dict[str, Any]:
    if hasattr(result, "as_dict") and callable(result.as_dict):
        return result.as_dict()
    if hasattr(result, "to_dict") and callable(result.to_dict):
        return result.to_dict()
    if isinstance(result, dict):
        return result
    # Last resort: attempt to serialize via __dict__.
    return getattr(result, "__dict__", {})


def strip_markdown(md: str) -> str:
    # Basic best-effort Markdown -> plain text conversion.
    text = md or ""

    # Remove fenced code blocks.
    text = re.sub(r"```.*?```", "", text, flags=re.DOTALL)
    # Remove inline code backticks.
    text = re.sub(r"`([^`]*)`", r"\1", text)
    # Convert links: [label](url) -> label
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    # Remove images: ![alt](url) -> alt
    text = re.sub(r"!\[([^\]]*)\]\([^)]+\)", r"\1", text)

    # Headings: strip leading #'s.
    text = re.sub(r"(?m)^\s{0,3}#{1,6}\s*", "", text)
    # List markers.
    text = re.sub(r"(?m)^\s*[-*+]\s+", "", text)
    # Blockquotes.
    text = re.sub(r"(?m)^\s*>\s?", "", text)

    # Tables: for simple pipe-separated rows, collapse cells.
    table_lines = []
    for line in text.splitlines():
        stripped = line.strip()
        if "|" in stripped and stripped.startswith("|") and stripped.count("|") >= 2:
            cells = stripped.strip("|").split("|")
            table_lines.append(" ".join(c.strip() for c in cells if c.strip()))
        else:
            table_lines.append(line)
    text = "\n".join(table_lines)

    # Emphasis markers.
    text = text.replace("**", "").replace("__", "")
    text = text.replace("*", "").replace("_", "")

    # Collapse excessive whitespace a bit.
    return re.sub(r"\n{3,}", "\n\n", text).strip() + ("\n" if text.strip() else "")


def save_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content or "", encoding="utf-8")


def save_json(path: Path, obj: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(obj, ensure_ascii=False, indent=2, default=str),
        encoding="utf-8",
    )


def upload_blob_bytes(
    *,
    blob_service: BlobServiceClient,
    container_name: str,
    blob_path: str,
    data: bytes,
    content_type: str,
) -> None:
    blob_name = blob_path.lstrip("/")
    container_client = blob_service.get_container_client(container_name)
    blob_client = container_client.get_blob_client(blob_name)

    blob_client.upload_blob(
        data,
        overwrite=True,
        content_settings=ContentSettings(content_type=content_type),
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Analyze a protocol PDF with DI Layout and persist artifacts."
    )
    parser.add_argument("--study-id", default=None, help="Overrides STUDY_ID.")
    parser.add_argument(
        "--blob-path",
        default=None,
        help="Overrides BLOB_PATH (blob path inside the storage container).",
    )
    parser.add_argument(
        "--model-id",
        default=os.getenv("DI_MODEL_ID", "prebuilt-layout"),
        help='DI model id (default: "prebuilt-layout").',
    )
    parser.add_argument(
        "--sas-ttl-minutes",
        type=int,
        default=int(os.getenv("DI_SAS_TTL_MINUTES", "15")),
        help="SAS TTL minutes (default: 15).",
    )
    args = parser.parse_args()

    # Loads `.env` if present; keeps real env vars as higher precedence.
    load_dotenv()

    study_id = args.study_id or os.getenv("STUDY_ID")
    if not study_id:
        raise ValueError("Missing required configuration: STUDY_ID.")

    blob_path = args.blob_path or os.getenv("BLOB_PATH") or os.getenv("PDF_PATH")
    if not blob_path:
        raise ValueError("Missing required configuration: BLOB_PATH (or PDF_PATH).")

    storage_connection_string = os.getenv("STORAGE_CONNECTION_STRING")
    container_name = os.getenv("STORAGE_CONTAINER")
    if not storage_connection_string or not container_name:
        # This script is blob-only per the intended pipeline.
        raise ValueError(
            "Missing required Blob Storage configuration: "
            "`STORAGE_CONNECTION_STRING` and `STORAGE_CONTAINER`."
        )

    di_endpoint = _require_env("DI_ENDPOINT")
    di_key = _require_env("DI_KEY")

    print("Generating SAS URL for DI Layout to read the PDF...")
    sas_url = _generate_read_sas_url(
        storage_connection_string=storage_connection_string,
        container_name=container_name,
        blob_path=blob_path,
        ttl_minutes=args.sas_ttl_minutes,
    )

    print(f"Submitting DI Layout analyze request (model_id={args.model_id})...")
    client = DocumentIntelligenceClient(di_endpoint, AzureKeyCredential(di_key))
    poller = client.begin_analyze_document(
        args.model_id,
        body={"urlSource": sas_url},
        output_content_format="markdown",
    )
    result = poller.result()

    raw_dict = _as_serializable_dict(result)
    markdown_content = raw_dict.get("content") if isinstance(raw_dict, dict) else None
    if not markdown_content:
        markdown_content = getattr(result, "content", None) or ""

    plain_text = strip_markdown(markdown_content)

    local_base = Path("output") / study_id / "layout"
    raw_out_path = local_base / "raw" / "analyze_result.json"
    md_out_path = local_base / "rendered" / "protocol_v1.md"
    txt_out_path = local_base / "rendered" / "protocol_v1.txt"

    print("Saving local artifacts...")
    save_json(raw_out_path, raw_dict)
    save_text(md_out_path, markdown_content)
    save_text(txt_out_path, plain_text)

    print("Uploading artifacts to Blob Storage...")
    blob_service = BlobServiceClient.from_connection_string(storage_connection_string)
    blob_prefix = f"extractions/{study_id}/layout"

    upload_blob_bytes(
        blob_service=blob_service,
        container_name=container_name,
        blob_path=f"{blob_prefix}/raw/analyze_result.json",
        data=raw_out_path.read_bytes(),
        content_type="application/json",
    )
    upload_blob_bytes(
        blob_service=blob_service,
        container_name=container_name,
        blob_path=f"{blob_prefix}/rendered/protocol_v1.md",
        data=md_out_path.read_bytes(),
        content_type="text/markdown",
    )
    upload_blob_bytes(
        blob_service=blob_service,
        container_name=container_name,
        blob_path=f"{blob_prefix}/rendered/protocol_v1.txt",
        data=txt_out_path.read_bytes(),
        content_type="text/plain",
    )

    print("Done.")
    content_len = len(markdown_content or "")
    print(f"Markdown content length: {content_len} chars")
    print(f"Local JSON: {raw_out_path}")
    print(f"Local Markdown: {md_out_path}")
    print(f"Local Text: {txt_out_path}")


if __name__ == "__main__":
    main()


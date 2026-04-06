"""Azure AI Document Intelligence Layout analysis."""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any, Dict, Tuple

from azure.ai.documentintelligence import DocumentIntelligenceClient
from azure.core.credentials import AzureKeyCredential
from azure.storage.blob import BlobServiceClient

from pdcheck_factory import blob_io


def as_serializable_dict(result: Any) -> Dict[str, Any]:
    if hasattr(result, "as_dict") and callable(result.as_dict):
        return result.as_dict()
    if hasattr(result, "to_dict") and callable(result.to_dict):
        return result.to_dict()
    if isinstance(result, dict):
        return result
    return getattr(result, "__dict__", {})


def strip_markdown(md: str) -> str:
    text = md or ""
    text = re.sub(r"```.*?```", "", text, flags=re.DOTALL)
    text = re.sub(r"`([^`]*)`", r"\1", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"!\[([^\]]*)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"(?m)^\s{0,3}#{1,6}\s*", "", text)
    text = re.sub(r"(?m)^\s*[-*+]\s+", "", text)
    text = re.sub(r"(?m)^\s*>\s?", "", text)
    table_lines = []
    for line in text.splitlines():
        stripped = line.strip()
        if "|" in stripped and stripped.startswith("|") and stripped.count("|") >= 2:
            cells = stripped.strip("|").split("|")
            table_lines.append(" ".join(c.strip() for c in cells if c.strip()))
        else:
            table_lines.append(line)
    text = "\n".join(table_lines)
    text = text.replace("**", "").replace("__", "")
    text = text.replace("*", "").replace("_", "")
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


def run_layout_for_blob(
    *,
    study_id: str,
    doc_role: str,
    source_blob_path: str,
    local_layout_base: Path,
    blob_service: BlobServiceClient,
    container_name: str,
    storage_connection_string: str,
    di_endpoint: str,
    di_key: str,
    model_id: str | None = None,
    sas_ttl_minutes: int = 15,
    upload_to_blob: bool = True,
    debug_blob: bool = False,
) -> Tuple[Path, Path, Path]:
    """
    Run prebuilt-layout on a PDF in Blob; write raw JSON, markdown, plain text under local_layout_base
    and upload to extractions/<study_id>/<doc_role>/layout/...
    """
    model_id = model_id or os.getenv("DI_MODEL_ID", "prebuilt-layout")

    if debug_blob:
        desc = blob_io.describe_blob(
            blob_service=blob_service,
            container_name=container_name,
            blob_path=source_blob_path,
        )
        print(
            f"[debug-blob] DI input blob {source_blob_path!r} "
            f"in container {container_name!r}: "
            f"{desc or 'MISSING'}"
        )

    print(f"[{doc_role}] Generating SAS URL for Document Intelligence...")
    sas_url = blob_io.generate_read_sas_url(
        storage_connection_string=storage_connection_string,
        container_name=container_name,
        blob_path=source_blob_path,
        ttl_minutes=sas_ttl_minutes,
    )

    print(f"[{doc_role}] Submitting DI Layout (model_id={model_id})...")
    client = DocumentIntelligenceClient(di_endpoint, AzureKeyCredential(di_key))
    poller = client.begin_analyze_document(
        model_id,
        body={"urlSource": sas_url},
        output_content_format="markdown",
    )
    result = poller.result()

    raw_dict = as_serializable_dict(result)
    markdown_content = raw_dict.get("content") if isinstance(raw_dict, dict) else None
    if not markdown_content:
        markdown_content = getattr(result, "content", None) or ""

    plain_text = strip_markdown(markdown_content)

    raw_out_path = local_layout_base / "raw" / "analyze_result.json"
    md_out_path = local_layout_base / "rendered" / "source.md"
    txt_out_path = local_layout_base / "rendered" / "source.txt"

    print(f"[{doc_role}] Saving local artifacts under {local_layout_base}...")
    save_json(raw_out_path, raw_dict)
    save_text(md_out_path, markdown_content or "")
    save_text(txt_out_path, plain_text)

    if upload_to_blob:
        blob_prefix = f"extractions/{study_id}/{doc_role}/layout"
        print(f"[{doc_role}] Uploading to blob prefix {blob_prefix}/...")
        blob_io.upload_blob_bytes(
            blob_service=blob_service,
            container_name=container_name,
            blob_path=f"{blob_prefix}/raw/analyze_result.json",
            data=raw_out_path.read_bytes(),
            content_type="application/json",
            debug=debug_blob,
        )
        blob_io.upload_blob_bytes(
            blob_service=blob_service,
            container_name=container_name,
            blob_path=f"{blob_prefix}/rendered/source.md",
            data=md_out_path.read_bytes(),
            content_type="text/markdown",
            debug=debug_blob,
        )
        blob_io.upload_blob_bytes(
            blob_service=blob_service,
            container_name=container_name,
            blob_path=f"{blob_prefix}/rendered/source.txt",
            data=txt_out_path.read_bytes(),
            content_type="text/plain",
            debug=debug_blob,
        )

    print(f"[{doc_role}] Done. Markdown length: {len(markdown_content or '')} chars.")
    return raw_out_path, md_out_path, txt_out_path


def upload_existing_layout_to_blob(
    *,
    study_id: str,
    doc_role: str,
    local_layout_base: Path,
    blob_service: BlobServiceClient,
    container_name: str,
    debug_blob: bool = False,
) -> Tuple[Path, Path, Path]:
    """
    Upload layout artifacts already on disk to
    extractions/<study_id>/<doc_role>/layout/... (no Document Intelligence call).
    """
    raw_out_path = local_layout_base / "raw" / "analyze_result.json"
    md_out_path = local_layout_base / "rendered" / "source.md"
    txt_out_path = local_layout_base / "rendered" / "source.txt"
    for path in (raw_out_path, md_out_path, txt_out_path):
        if not path.is_file():
            raise FileNotFoundError(
                f"Missing layout artifact: {path} "
                f"(run extract without --upload-only first, or fix paths)"
            )

    blob_prefix = f"extractions/{study_id}/{doc_role}/layout"
    print(f"[{doc_role}] Uploading existing local layout to blob prefix {blob_prefix}/...")
    blob_io.upload_blob_bytes(
        blob_service=blob_service,
        container_name=container_name,
        blob_path=f"{blob_prefix}/raw/analyze_result.json",
        data=raw_out_path.read_bytes(),
        content_type="application/json",
        debug=debug_blob,
    )
    blob_io.upload_blob_bytes(
        blob_service=blob_service,
        container_name=container_name,
        blob_path=f"{blob_prefix}/rendered/source.md",
        data=md_out_path.read_bytes(),
        content_type="text/markdown",
        debug=debug_blob,
    )
    blob_io.upload_blob_bytes(
        blob_service=blob_service,
        container_name=container_name,
        blob_path=f"{blob_prefix}/rendered/source.txt",
        data=txt_out_path.read_bytes(),
        content_type="text/plain",
        debug=debug_blob,
    )
    print(f"[{doc_role}] Upload complete.")
    return raw_out_path, md_out_path, txt_out_path

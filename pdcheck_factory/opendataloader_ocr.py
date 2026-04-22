"""OpenDataLoader OCR helpers for protocol and aCRF PDFs."""

from __future__ import annotations

import tempfile
import shutil
from pathlib import Path
from typing import Tuple

from azure.storage.blob import BlobServiceClient

from pdcheck_factory import blob_io
from pdcheck_factory.di_layout import save_text, strip_markdown


def _resolve_markdown_output(output_dir: Path, input_pdf: Path) -> Path:
    expected = output_dir / f"{input_pdf.stem}.md"
    if expected.is_file():
        return expected
    candidates = sorted(output_dir.glob("*.md"))
    if not candidates:
        raise FileNotFoundError(
            f"OpenDataLoader did not produce markdown output in {output_dir}."
        )
    return candidates[0]


def run_ocr_for_blob(
    *,
    doc_role: str,
    source_blob_path: str,
    local_output_base: Path,
    blob_service: BlobServiceClient,
    container_name: str,
) -> Tuple[Path, Path]:
    """
    Download source PDF from blob, run OpenDataLoader OCR, and write markdown/text.

    Output layout:
      <local_output_base>/rendered/source.md
      <local_output_base>/rendered/source.txt
    """
    try:
        import opendataloader_pdf  # type: ignore[import-not-found]
    except Exception as ex:  # pragma: no cover - depends on optional runtime dependency
        raise RuntimeError(
            "OpenDataLoader OCR requested but opendataloader_pdf is not installed. "
            "Install project dependencies with `pip install -e .`."
        ) from ex
    if shutil.which("java") is None:
        raise RuntimeError(
            "OpenDataLoader OCR requires Java, but `java` was not found in PATH. "
            "Install a JRE/JDK (for Ubuntu/WSL: `sudo apt-get update && "
            "sudo apt-get install -y openjdk-17-jre-headless`) and retry."
        )

    with tempfile.TemporaryDirectory(prefix=f"odl_{doc_role}_") as td:
        temp_dir = Path(td)
        input_pdf = temp_dir / f"{doc_role}.pdf"
        out_dir = temp_dir / "odl_output"
        out_dir.mkdir(parents=True, exist_ok=True)

        print(f"[{doc_role}] Downloading source PDF for OpenDataLoader OCR...")
        pdf_bytes = blob_io.download_blob_bytes(
            blob_service=blob_service,
            container_name=container_name,
            blob_path=source_blob_path,
        )
        input_pdf.write_bytes(pdf_bytes)

        print(f"[{doc_role}] Running OpenDataLoader OCR...")
        try:
            opendataloader_pdf.convert(
                input_path=[str(input_pdf)],
                output_dir=str(out_dir),
                format="markdown",
            )
        except FileNotFoundError as ex:
            if "java" in str(ex):
                raise RuntimeError(
                    "OpenDataLoader OCR could not start Java (`java` not found). "
                    "Install Java and ensure it is available in PATH."
                ) from ex
            raise

        generated_md = _resolve_markdown_output(out_dir, input_pdf)
        markdown_content = generated_md.read_text(encoding="utf-8")
        plain_text = strip_markdown(markdown_content)

    md_out_path = local_output_base / "rendered" / "source.md"
    txt_out_path = local_output_base / "rendered" / "source.txt"
    local_output_base.mkdir(parents=True, exist_ok=True)
    save_text(md_out_path, markdown_content)
    save_text(txt_out_path, plain_text)

    print(
        f"[{doc_role}] OpenDataLoader OCR done. Markdown length: {len(markdown_content)} chars."
    )
    return md_out_path, txt_out_path

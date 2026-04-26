"""Typer CLI for the Azure MVP pipeline."""

from __future__ import annotations

import os
import json
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Literal, Optional, Tuple

import typer
from dotenv import load_dotenv

from pdcheck_factory import blob_io, di_layout, opendataloader_ocr, paths, pipeline_v2
from pdcheck_factory import llm as llm_mod
from pdcheck_factory import step2_merge
from pdcheck_factory import step2_review
from pdcheck_factory.json_util import load_schema, read_json, validate, write_json
from pdcheck_factory.protocol_markdown import (
    build_sections_manifest,
    format_section_for_prompt,
    get_section_by_id,
    load_manifest,
    select_section_ids,
    write_manifest,
    write_numbered_fragment,
)
app = typer.Typer(no_args_is_help=True, help="PD Check Factory — Azure MVP monolith.")

protocol_app = typer.Typer(help="Segment protocol Markdown and run Step 1 extraction per section.")
sections_app = typer.Typer(help="List, preview, or extract sections.")
protocol_app.add_typer(sections_app, name="sections")
acrf_app = typer.Typer(help="Tools for aCRF markdown processing.")
ui_app = typer.Typer(help="Pipeline V2 Streamlit review UI.", no_args_is_help=True)
v2_app = typer.Typer(help="Pipeline V2 runner (paragraph anchors, staged reviews).", no_args_is_help=True)

_TOC_ROW = re.compile(
    r"<tr>\s*<td>(.*?)</td>\s*<td>(.*?)</td>\s*</tr>",
    re.IGNORECASE | re.DOTALL,
)
_TOC_CODE = re.compile(r"\(([^)]+)\)\s*$")
_PAGE_HEADER = re.compile(r"^Page:\s*(.+)$")
_PAGE_CODE = re.compile(r"\(([^)]+)\)")
_PAGE_NUMBER = re.compile(r'<!--\s*PageNumber\s*=\s*"Page\s+(\d+)\s+of\s+\d+\s+pages"\s*-->')


def _load_env() -> None:
    load_dotenv()


def _slugify_filename(s: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9]+", "_", s.strip()).strip("_").lower()
    return cleaned or "section"


def _read_acrf_source_md(study_id: str, output_dir: Path) -> Path:
    acrf_md = (
        paths.local_extraction_layout(study_id, "acrf", output_dir)
        / "rendered"
        / "source.md"
    )
    if not acrf_md.exists():
        raise typer.BadParameter(
            f"Missing {acrf_md}. Run `extract --study-id {study_id}` first."
        )
    return acrf_md


def _default_acrf_toc_dir(study_id: str, output_dir: Path) -> Path:
    return _read_acrf_source_md(study_id, output_dir).parent / "sections_toc"


def _acrf_section_meta_from_file(section_md: Path) -> Tuple[str, List[str]]:
    stem = section_md.stem
    section_id = f"acrf:{stem}"
    if "_" in stem:
        pretty = stem.split("_", 1)[1].replace("_", " ").strip()
    else:
        pretty = stem.replace("_", " ").strip()
    section_path = [pretty] if pretty else [section_id]
    return section_id, section_path


def run_acrf_split_toc(
    *,
    source_md: Path,
    destination_dir: Path,
    write_manifest: bool,
) -> Tuple[int, Path]:
    text = source_md.read_text(encoding="utf-8")
    lines = text.splitlines(keepends=True)

    page_marker = "\n".join(lines[:300])
    rows = _TOC_ROW.findall(page_marker)
    toc: List[Dict[str, object]] = []
    for raw_name, raw_page in rows:
        name = " ".join(raw_name.split())
        page_txt = raw_page.strip()
        if not page_txt.isdigit():
            continue
        page_no = int(page_txt)
        m_code = _TOC_CODE.search(name)
        code = m_code.group(1) if m_code else ""
        toc.append({"name": name, "code": code, "toc_page": page_no})
    if not toc:
        raise typer.BadParameter(f"No TOC rows found in {source_md}.")

    starts_by_code: Dict[str, int] = {}
    starts_by_page: Dict[int, int] = {}

    for i, line in enumerate(lines, start=1):
        ph = _PAGE_HEADER.match(line.rstrip("\n"))
        if ph:
            full = ph.group(1)
            m_code = _PAGE_CODE.search(full)
            if m_code:
                code = m_code.group(1)
                starts_by_code.setdefault(code, i)
        pn = _PAGE_NUMBER.search(line)
        if pn:
            page_num = int(pn.group(1))
            starts_by_page.setdefault(page_num, i + 1)

    out_rows: List[Dict[str, object]] = []
    sorted_toc = sorted(toc, key=lambda x: int(x["toc_page"]))
    for idx, row in enumerate(sorted_toc):
        code = str(row["code"])
        toc_page = int(row["toc_page"])
        start = starts_by_code.get(code) or starts_by_page.get(toc_page)
        if start is None:
            continue
        end = len(lines)
        for nxt in sorted_toc[idx + 1 :]:
            n_code = str(nxt["code"])
            n_page = int(nxt["toc_page"])
            n_start = starts_by_code.get(n_code) or starts_by_page.get(n_page)
            if n_start is not None and n_start > start:
                end = n_start - 1
                break
        row["start_line"] = start
        row["end_line"] = end
        out_rows.append(row)

    if not out_rows:
        raise typer.BadParameter("Could not determine section boundaries from TOC.")

    destination_dir.mkdir(parents=True, exist_ok=True)
    written = 0
    for row in out_rows:
        name = str(row["name"])
        code = str(row["code"])
        page = int(row["toc_page"])
        start = int(row["start_line"])
        end = int(row["end_line"])
        body = "".join(lines[start - 1 : end])
        label = f"{code}_{name}" if code else name
        file_name = f"{page:03d}_{_slugify_filename(label)}.md"
        out_path = destination_dir / file_name
        out_path.write_text(body, encoding="utf-8")
        written += 1

    manifest_path = destination_dir / "sections_manifest.json"
    if write_manifest:
        manifest = {
            "source_md": str(source_md),
            "sections": out_rows,
        }
        write_json(manifest_path, manifest)

    return written, manifest_path


def run_acrf_summarize_sections(
    *,
    study_id: str,
    output_dir: Path,
    upload: bool,
    source_dir: Optional[Path] = None,
) -> Path:
    """Summarize each split aCRF TOC section with structured LLM output."""
    _load_env()
    toc_dir = source_dir or _default_acrf_toc_dir(study_id, output_dir)
    if not toc_dir.is_dir():
        raise typer.BadParameter(
            f"Missing aCRF TOC section directory: {toc_dir}. "
            "Run `pdcheck acrf split-toc --study-id ...` first."
        )
    section_files = sorted(
        p for p in toc_dir.glob("*.md") if p.name.lower() != "sections_manifest.json"
    )
    if not section_files:
        raise typer.BadParameter(f"No aCRF TOC section markdown files found under {toc_dir}.")

    out_dir = paths.local_acrf_summary_sections_dir(study_id, output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    summary_schema = load_schema("acrf_section_summary.schema.json")

    for section_md in section_files:
        section_id, section_path = _acrf_section_meta_from_file(section_md)
        print(f"aCRF summarize: {section_id} …")
        out_obj = llm_mod.summarize_acrf_section(
            study_id=study_id,
            acrf_section_id=section_id,
            acrf_section_path=section_path,
            section_markdown=section_md.read_text(encoding="utf-8"),
        )
        errs = validate(out_obj, summary_schema)
        if errs:
            raise typer.BadParameter(
                f"aCRF section summary failed schema validation ({section_id}): "
                + "; ".join(errs[:10])
            )
        out_path = paths.local_acrf_summary_section(study_id, section_id, output_dir)
        write_json(out_path, out_obj)
        print(f"  Wrote {out_path}")
        _upload_if_enabled(
            out_path,
            paths.acrf_summary_section_blob(study_id, section_id),
            upload=upload,
            content_type="application/json",
        )
    return out_dir


def run_acrf_merge_summaries(*, study_id: str, output_dir: Path, upload: bool) -> Path:
    """Merge per-section aCRF summaries into one consolidated artifact."""
    _load_env()
    sections_dir = paths.local_acrf_summary_sections_dir(study_id, output_dir)
    if not sections_dir.is_dir():
        raise typer.BadParameter(
            f"Missing {sections_dir}. Run `pdcheck acrf summarize-sections --study-id {study_id}` first."
        )
    section_files = sorted(sections_dir.glob("*.json"))
    if not section_files:
        raise typer.BadParameter(f"No aCRF section summaries found under {sections_dir}.")

    section_schema = load_schema("acrf_section_summary.schema.json")
    section_summaries: List[Dict[str, object]] = []
    dataset_index_map: Dict[str, Dict[str, object]] = {}
    for path in section_files:
        obj = read_json(path)
        errs = validate(obj, section_schema)
        if errs:
            raise typer.BadParameter(
                f"aCRF section summary failed schema validation: {path} :: {'; '.join(errs[:10])}"
            )
        section_summaries.append(obj)
        sec_id = str(obj.get("acrf_section_id", ""))
        for ds in obj.get("datasets", []):
            if not isinstance(ds, dict):
                continue
            ds_name = str(ds.get("dataset_name", "")).strip()
            if not ds_name:
                continue
            bucket = dataset_index_map.setdefault(
                ds_name,
                {"dataset_name": ds_name, "column_names": set(), "source_section_ids": set()},
            )
            bucket["source_section_ids"].add(sec_id)
            for col in ds.get("columns", []):
                if not isinstance(col, dict):
                    continue
                col_name = str(col.get("column_name", "")).strip()
                if col_name:
                    bucket["column_names"].add(col_name)

    dataset_index = []
    for ds_name in sorted(dataset_index_map):
        bucket = dataset_index_map[ds_name]
        dataset_index.append(
            {
                "dataset_name": ds_name,
                "column_names": sorted(bucket["column_names"]),
                "source_section_ids": sorted(bucket["source_section_ids"]),
            }
        )

    merged = {
        "schema_version": "1.0.0",
        "study_id": study_id,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "section_summaries": section_summaries,
        "dataset_index": dataset_index,
    }
    merged_schema = load_schema("acrf_section_summaries_merged.schema.json")
    out_errs = validate(merged, merged_schema)
    if out_errs:
        raise typer.BadParameter(
            "aCRF merged summary failed schema validation: " + "; ".join(out_errs[:10])
        )
    out_path = paths.local_acrf_summary_merged(study_id, output_dir)
    write_json(out_path, merged)
    print(f"Wrote {out_path}")
    _upload_if_enabled(
        out_path,
        paths.acrf_summary_merged_blob(study_id),
        upload=upload,
        content_type="application/json",
    )
    return out_path


def run_acrf_summarize(*, study_id: str, output_dir: Path, upload: bool) -> Path:
    """Summarize aCRF TOC sections and merge into one artifact."""
    run_acrf_summarize_sections(
        study_id=study_id,
        output_dir=output_dir,
        upload=upload,
        source_dir=None,
    )
    return run_acrf_merge_summaries(study_id=study_id, output_dir=output_dir, upload=upload)


def _debug_log_local_layout_tree(
    *, study_id: str, output_dir: Path, doc_role: str
) -> None:
    base = paths.local_extraction_layout(study_id, doc_role, output_dir)
    print(f"[debug-blob] local {doc_role} layout: {base}")
    for rel in ("raw/analyze_result.json", "rendered/source.md", "rendered/source.txt"):
        p = base / rel
        if p.is_file():
            print(f"[debug-blob]   - {rel}: {p.stat().st_size} bytes")
        else:
            print(f"[debug-blob]   - {rel}: (missing)")


def _debug_log_extract_blob_state(
    *,
    phase: str,
    study_id: str,
    output_dir: Path,
    blob_service,
    container_name: str,
    protocol_blob: str,
    acrf_blob: str,
    skip_acrf: bool,
    list_local_layout: bool,
) -> None:
    print(f"[debug-blob] ========== {phase} ==========")
    cs = blob_io.require_env("STORAGE_CONNECTION_STRING")
    account = blob_io.account_name_from_connection_string(cs) or "(unknown)"
    print(f"[debug-blob] storage_account={account!r} container={container_name!r}")
    c_ok = blob_io.container_exists(
        blob_service=blob_service, container_name=container_name
    )
    print(f"[debug-blob] container_exists={c_ok}")
    if not c_ok:
        print("[debug-blob] skipping blob listings (create container or fix STORAGE_CONTAINER)")
        if list_local_layout:
            _debug_log_local_layout_tree(
                study_id=study_id, output_dir=output_dir, doc_role="protocol"
            )
            if not skip_acrf:
                _debug_log_local_layout_tree(
                    study_id=study_id, output_dir=output_dir, doc_role="acrf"
                )
        return

    raw_prefix = f"raw/{study_id}/"
    try:
        raw_list = blob_io.list_blob_names_with_prefix(
            blob_service=blob_service,
            container_name=container_name,
            prefix=raw_prefix,
        )
    except Exception as ex:
        print(f"[debug-blob] list prefix {raw_prefix!r} failed: {ex}")
        raw_list = []
    print(f"[debug-blob] blob input folder {raw_prefix!r}: {len(raw_list)} object(s)")
    for name in raw_list:
        print(f"[debug-blob]   - {name}")

    pr = blob_io.describe_blob(
        blob_service=blob_service,
        container_name=container_name,
        blob_path=protocol_blob,
    )
    print(
        f"[debug-blob] expected protocol PDF {protocol_blob!r}: "
        f"{pr or 'MISSING'}"
    )
    if not skip_acrf:
        ar = blob_io.describe_blob(
            blob_service=blob_service,
            container_name=container_name,
            blob_path=acrf_blob,
        )
        print(
            f"[debug-blob] expected aCRF PDF {acrf_blob!r}: "
            f"{ar or 'MISSING'}"
        )

    for doc_role in ("protocol", "acrf"):
        if doc_role == "acrf" and skip_acrf:
            continue
        out_p = f"extractions/{study_id}/{doc_role}/layout"
        try:
            out_list = blob_io.list_blob_names_with_prefix(
                blob_service=blob_service,
                container_name=container_name,
                prefix=out_p,
            )
        except Exception as ex:
            print(f"[debug-blob] list prefix {out_p!r} failed: {ex}")
            out_list = []
        print(
            f"[debug-blob] blob output folder {out_p!r}/: "
            f"{len(out_list)} object(s)"
        )
        for name in out_list:
            print(f"[debug-blob]   - {name}")

    if list_local_layout:
        _debug_log_local_layout_tree(
            study_id=study_id, output_dir=output_dir, doc_role="protocol"
        )
        if not skip_acrf:
            _debug_log_local_layout_tree(
                study_id=study_id, output_dir=output_dir, doc_role="acrf"
            )


def _upload_if_enabled(
    local_file: Path, blob_path: str, *, upload: bool, content_type: str
) -> None:
    if not upload:
        return
    bs = blob_io.blob_service_from_env()
    container = blob_io.container_from_env()
    blob_io.upload_blob_bytes(
        blob_service=bs,
        container_name=container,
        blob_path=blob_path,
        data=local_file.read_bytes(),
        content_type=content_type,
    )
    print(f"Uploaded {blob_path}")


def run_extract(
    *,
    study_id: str,
    protocol_blob: Optional[str],
    acrf_blob: Optional[str],
    output_dir: Path,
    model_id: Optional[str],
    sas_ttl: int,
    upload: bool,
    skip_acrf: bool,
    upload_only: bool,
    run_opendataloader_ocr: bool,
    opendataloader_only: bool,
    debug_blob: bool = False,
) -> None:
    """Run extraction for protocol (+ optional aCRF) PDFs in Blob."""
    _load_env()
    if upload_only and not upload:
        raise typer.BadParameter("--upload-only cannot be used with --no-upload.")
    if upload_only and opendataloader_only:
        raise typer.BadParameter("--upload-only cannot be used with --opendataloader-only.")
    if opendataloader_only and not run_opendataloader_ocr:
        raise typer.BadParameter(
            "--opendataloader-only requires --opendataloader-ocr (or omit --no-opendataloader-ocr)."
        )

    bs = blob_io.blob_service_from_env()
    container = blob_io.container_from_env()
    protocol_resolved = protocol_blob or paths.raw_protocol_blob(study_id)
    acrf_resolved = acrf_blob or paths.raw_acrf_blob(study_id)

    if upload_only:
        if debug_blob:
            _debug_log_extract_blob_state(
                phase="extract upload-only (start)",
                study_id=study_id,
                output_dir=output_dir,
                blob_service=bs,
                container_name=container,
                protocol_blob=protocol_resolved,
                acrf_blob=acrf_resolved,
                skip_acrf=skip_acrf,
                list_local_layout=True,
            )
        local_proto = paths.local_extraction_layout(study_id, "protocol", output_dir)
        try:
            di_layout.upload_existing_layout_to_blob(
                study_id=study_id,
                doc_role="protocol",
                local_layout_base=local_proto,
                blob_service=bs,
                container_name=container,
                debug_blob=debug_blob,
            )
        except FileNotFoundError as ex:
            raise typer.BadParameter(str(ex)) from ex

        if debug_blob:
            _debug_log_extract_blob_state(
                phase="extract upload-only (after protocol upload)",
                study_id=study_id,
                output_dir=output_dir,
                blob_service=bs,
                container_name=container,
                protocol_blob=protocol_resolved,
                acrf_blob=acrf_resolved,
                skip_acrf=skip_acrf,
                list_local_layout=True,
            )

        if skip_acrf:
            return

        local_acrf = paths.local_extraction_layout(study_id, "acrf", output_dir)
        try:
            di_layout.upload_existing_layout_to_blob(
                study_id=study_id,
                doc_role="acrf",
                local_layout_base=local_acrf,
                blob_service=bs,
                container_name=container,
                debug_blob=debug_blob,
            )
        except FileNotFoundError as ex:
            raise typer.BadParameter(str(ex)) from ex

        if debug_blob:
            _debug_log_extract_blob_state(
                phase="extract upload-only (after aCRF upload)",
                study_id=study_id,
                output_dir=output_dir,
                blob_service=bs,
                container_name=container,
                protocol_blob=protocol_resolved,
                acrf_blob=acrf_resolved,
                skip_acrf=False,
                list_local_layout=True,
            )
        return

    if opendataloader_only:
        if not blob_io.blob_exists(
            blob_service=bs, container_name=container, blob_path=protocol_resolved
        ):
            raise typer.BadParameter(
                f"Protocol blob not found: {protocol_resolved} (container {container})"
            )
        opendataloader_ocr.run_ocr_for_blob(
            doc_role="protocol",
            source_blob_path=protocol_resolved,
            local_output_base=paths.local_extraction_opendataloader(
                study_id, "protocol", output_dir
            ),
            blob_service=bs,
            container_name=container,
        )
        if skip_acrf:
            return
        if not blob_io.blob_exists(
            blob_service=bs, container_name=container, blob_path=acrf_resolved
        ):
            raise typer.BadParameter(
                f"aCRF blob not found: {acrf_resolved}. Upload it or pass --skip-acrf."
            )
        opendataloader_ocr.run_ocr_for_blob(
            doc_role="acrf",
            source_blob_path=acrf_resolved,
            local_output_base=paths.local_extraction_opendataloader(
                study_id, "acrf", output_dir
            ),
            blob_service=bs,
            container_name=container,
        )
        return

    cs = blob_io.require_env("STORAGE_CONNECTION_STRING")
    di_endpoint = blob_io.require_env("DI_ENDPOINT")
    di_key = blob_io.require_env("DI_KEY")

    if debug_blob:
        _debug_log_extract_blob_state(
            phase="extract (start, before DI)",
            study_id=study_id,
            output_dir=output_dir,
            blob_service=bs,
            container_name=container,
            protocol_blob=protocol_resolved,
            acrf_blob=acrf_resolved,
            skip_acrf=skip_acrf,
            list_local_layout=True,
        )

    if not blob_io.blob_exists(
        blob_service=bs, container_name=container, blob_path=protocol_resolved
    ):
        raise typer.BadParameter(
            f"Protocol blob not found: {protocol_resolved} (container {container})"
        )

    local_proto = paths.local_extraction_layout(study_id, "protocol", output_dir)
    di_layout.run_layout_for_blob(
        study_id=study_id,
        doc_role="protocol",
        source_blob_path=protocol_resolved,
        local_layout_base=local_proto,
        blob_service=bs,
        container_name=container,
        storage_connection_string=cs,
        di_endpoint=di_endpoint,
        di_key=di_key,
        model_id=model_id,
        sas_ttl_minutes=sas_ttl,
        upload_to_blob=upload,
        debug_blob=debug_blob,
    )
    if run_opendataloader_ocr:
        opendataloader_ocr.run_ocr_for_blob(
            doc_role="protocol",
            source_blob_path=protocol_resolved,
            local_output_base=paths.local_extraction_opendataloader(
                study_id, "protocol", output_dir
            ),
            blob_service=bs,
            container_name=container,
        )

    if debug_blob:
        _debug_log_extract_blob_state(
            phase="extract (after protocol)",
            study_id=study_id,
            output_dir=output_dir,
            blob_service=bs,
            container_name=container,
            protocol_blob=protocol_resolved,
            acrf_blob=acrf_resolved,
            skip_acrf=skip_acrf,
            list_local_layout=True,
        )

    if skip_acrf:
        return

    if not blob_io.blob_exists(
        blob_service=bs, container_name=container, blob_path=acrf_resolved
    ):
        raise typer.BadParameter(
            f"aCRF blob not found: {acrf_resolved}. Upload it or pass --skip-acrf."
        )

    local_acrf = paths.local_extraction_layout(study_id, "acrf", output_dir)
    di_layout.run_layout_for_blob(
        study_id=study_id,
        doc_role="acrf",
        source_blob_path=acrf_resolved,
        local_layout_base=local_acrf,
        blob_service=bs,
        container_name=container,
        storage_connection_string=cs,
        di_endpoint=di_endpoint,
        di_key=di_key,
        model_id=model_id,
        sas_ttl_minutes=sas_ttl,
        upload_to_blob=upload,
        debug_blob=debug_blob,
    )
    if run_opendataloader_ocr:
        opendataloader_ocr.run_ocr_for_blob(
            doc_role="acrf",
            source_blob_path=acrf_resolved,
            local_output_base=paths.local_extraction_opendataloader(
                study_id, "acrf", output_dir
            ),
            blob_service=bs,
            container_name=container,
        )

    if debug_blob:
        _debug_log_extract_blob_state(
            phase="extract (after aCRF)",
            study_id=study_id,
            output_dir=output_dir,
            blob_service=bs,
            container_name=container,
            protocol_blob=protocol_resolved,
            acrf_blob=acrf_resolved,
            skip_acrf=False,
            list_local_layout=True,
        )


@app.command()
def extract(
    study_id: str = typer.Option(..., "--study-id", envvar="STUDY_ID"),
    protocol_blob: Optional[str] = typer.Option(
        None,
        "--protocol-blob",
        help="Blob path to protocol PDF (default raw/<study-id>/protocol.pdf)",
    ),
    acrf_blob: Optional[str] = typer.Option(
        None,
        "--acrf-blob",
        help="Blob path to aCRF PDF (default raw/<study-id>/acrf.pdf)",
    ),
    output_dir: Path = typer.Option(Path("output"), "--output-dir", "-o"),
    model_id: Optional[str] = typer.Option(None, "--model-id", envvar="DI_MODEL_ID"),
    sas_ttl: int = typer.Option(
        int(os.getenv("DI_SAS_TTL_MINUTES", "15")),
        "--sas-ttl-minutes",
    ),
    upload: bool = typer.Option(True, "--upload/--no-upload"),
    skip_acrf: bool = typer.Option(
        False, "--skip-acrf", help="Only extract protocol (aCRF Run skipped)."
    ),
    upload_only: bool = typer.Option(
        False,
        "--upload-only",
        help="Skip Document Intelligence; upload existing files under output/<study-id>/extractions/... to Blob.",
    ),
    run_opendataloader_ocr: bool = typer.Option(
        True,
        "--opendataloader-ocr/--no-opendataloader-ocr",
        help="Also run OpenDataLoader OCR and write markdown under output/<study-id>/extractions/<doc>/opendataloader/ for DI comparison.",
    ),
    opendataloader_only: bool = typer.Option(
        False,
        "--opendataloader-only",
        help="Skip Document Intelligence and run only OpenDataLoader OCR outputs.",
    ),
    debug_blob: bool = typer.Option(
        False,
        "--debug-blob",
        help="Log storage account, container presence, input/output blob prefixes, and local layout files.",
    ),
) -> None:
    """Run Document Intelligence Layout on protocol (+ aCRF) PDFs in Blob."""
    run_extract(
        study_id=study_id,
        protocol_blob=protocol_blob,
        acrf_blob=acrf_blob,
        output_dir=output_dir,
        model_id=model_id,
        sas_ttl=sas_ttl,
        upload=upload,
        skip_acrf=skip_acrf,
        upload_only=upload_only,
        run_opendataloader_ocr=run_opendataloader_ocr,
        opendataloader_only=opendataloader_only,
        debug_blob=debug_blob,
    )


def _read_protocol_source_md(study_id: str, output_dir: Path) -> Path:
    proto_md = (
        paths.local_extraction_layout(study_id, "protocol", output_dir)
        / "rendered"
        / "source.md"
    )
    if not proto_md.exists():
        raise typer.BadParameter(
            f"Missing {proto_md}. Run `extract --study-id {study_id}` first."
        )
    return proto_md


def _optional_acrf_markdown(study_id: str, output_dir: Path) -> Optional[str]:
    acrf_md = (
        paths.local_extraction_layout(study_id, "acrf", output_dir)
        / "rendered"
        / "source.md"
    )
    if not acrf_md.is_file():
        return None
    return acrf_md.read_text(encoding="utf-8")


def _optional_acrf_summary_context(study_id: str, output_dir: Path) -> Optional[str]:
    merged = paths.local_acrf_summary_merged(study_id, output_dir)
    if not merged.is_file():
        return None
    obj = read_json(merged)
    # Keep on-disk artifact human-readable, but pass compact JSON to LLM prompts.
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def _load_acrf_contexts(
    *,
    study_id: str,
    output_dir: Path,
    include_acrf: bool,
    use_acrf_summary: bool,
    caller: str,
) -> Tuple[Optional[str], Optional[str]]:
    """Return (raw_acrf_markdown, merged_acrf_summary_json_text)."""
    if not include_acrf:
        return None, None

    acrf_summary_context: Optional[str] = None
    if use_acrf_summary:
        acrf_summary_context = _optional_acrf_summary_context(study_id, output_dir)
        if acrf_summary_context:
            print(
                f"[{caller}] Including merged aCRF summary context from "
                f"{paths.local_acrf_summary_merged(study_id, output_dir)}."
            )
        else:
            print(
                f"[{caller}] --use-acrf-summary set but merged summary not found; "
                "falling back to raw aCRF/protocol context."
            )

    acrf = _optional_acrf_markdown(study_id, output_dir)
    if acrf and not acrf_summary_context:
        acrf_chars_total = len(acrf.strip())
        acrf_chars_used = min(acrf_chars_total, llm_mod.STEP1_ACRF_MAX_CHARS)
        pct_used = ((acrf_chars_used / acrf_chars_total) * 100.0) if acrf_chars_total else 0.0
        print(
            f"[{caller}] Including raw aCRF context (truncated by LLM layer): "
            f"{acrf_chars_used}/{acrf_chars_total} chars ({pct_used:.1f}%)."
        )
    elif not acrf:
        print(f"[{caller}] No aCRF source.md found; protocol-only prompts.")
    return acrf, acrf_summary_context


def run_protocol_segment(
    *,
    study_id: str,
    output_dir: Path,
    upload: bool,
    strip_page_markers: bool = True,
    rollup_max_section_level: Optional[int] = 1,
) -> Path:
    """Parse protocol source.md → sections_manifest.json (+ raw numbered fragments)."""
    _load_env()
    proto_md = _read_protocol_source_md(study_id, output_dir)
    protocol_markdown = proto_md.read_text(encoding="utf-8")
    manifest = build_sections_manifest(
        protocol_markdown,
        study_id=study_id,
        strip_page_markers=strip_page_markers,
        rollup_max_section_level=rollup_max_section_level,
    )
    out = paths.local_protocol_sections_manifest(study_id, output_dir)
    write_manifest(out, manifest)
    print(
        f"Wrote {out} ({len(manifest.get('sections', []))} sections); "
        f"manifest_schema_version={manifest.get('manifest_schema_version')!r}, "
        f"di_page_markers_stripped={manifest.get('di_page_markers_stripped')}, "
        f"rollup_max_section_level={manifest.get('rollup_max_section_level')}"
    )
    raw_dir = paths.local_protocol_sections_raw_dir(study_id, output_dir)
    for sec in manifest.get("sections", []):
        write_numbered_fragment(raw_dir, sec)
    _upload_if_enabled(
        out,
        paths.protocol_sections_manifest_blob(study_id),
        upload=upload,
        content_type="application/json",
    )
    return out


def run_protocol_sections_extract(
    *,
    study_id: str,
    output_dir: Path,
    upload: bool,
    all_sections: bool,
    section_id: List[str],
    match_regex: Optional[str],
    skip_section_id: List[str],
    skip_regex: Optional[str],
    include_acrf: bool,
    use_acrf_summary: bool = True,
    overwrite: bool = True,
) -> None:
    """Run Step 1 LLM per selected section; write pipeline/.../protocol_sections/step1/*.json."""
    _load_env()
    man_path = paths.local_protocol_sections_manifest(study_id, output_dir)
    if not man_path.exists():
        raise typer.BadParameter(
            f"Missing {man_path}. Run `pdcheck protocol segment --study-id {study_id}` first."
        )
    manifest = load_manifest(man_path)
    try:
        ids = select_section_ids(
            manifest,
            all_sections=all_sections,
            section_ids=section_id,
            match_regex=match_regex,
            skip_section_ids=skip_section_id,
            skip_regex=skip_regex,
        )
    except ValueError as ex:
        raise typer.BadParameter(str(ex)) from ex

    if overwrite:
        run_clear_stage(
            study_id=study_id,
            stage="step1",
            output_dir=output_dir,
            clear_blob=False,
        )

    acrf, acrf_summary_context = _load_acrf_contexts(
        study_id=study_id,
        output_dir=output_dir,
        include_acrf=include_acrf,
        use_acrf_summary=use_acrf_summary,
        caller="step1",
    )

    step1_dir = paths.local_protocol_sections_step1_dir(study_id, output_dir)
    step1_dir.mkdir(parents=True, exist_ok=True)

    for cid in ids:
        sec = get_section_by_id(manifest, cid)
        assert sec is not None
        if not sec.get("sentences"):
            print(f"Skip (no sentences): {cid}")
            continue
        print(f"Step 1 extract: {cid} …")
        out_obj = llm_mod.extract_protocol_section_step1(
            study_id=study_id,
            section=sec,
            acrf_markdown=acrf,
            acrf_summary_context=acrf_summary_context,
        )
        safe = cid.replace(":", "_")
        out_path = step1_dir / f"{safe}.json"
        write_json(out_path, out_obj)
        print(f"  Wrote {out_path}")
        _upload_if_enabled(
            out_path,
            paths.protocol_section_step1_blob(study_id, cid),
            upload=upload,
            content_type="application/json",
        )


def run_rules(
    *,
    study_id: str,
    output_dir: Path,
    upload: bool,
    strip_page_markers: bool = True,
    rollup_max_section_level: Optional[int] = 1,
    use_acrf_summary: bool = True,
    overwrite: bool = True,
) -> None:
    """Alias: segment protocol + Step 1 extract for all sections."""
    run_protocol_segment(
        study_id=study_id,
        output_dir=output_dir,
        upload=upload,
        strip_page_markers=strip_page_markers,
        rollup_max_section_level=rollup_max_section_level,
    )
    run_protocol_sections_extract(
        study_id=study_id,
        output_dir=output_dir,
        upload=upload,
        all_sections=True,
        section_id=[],
        match_regex=None,
        skip_section_id=[],
        skip_regex=None,
        include_acrf=True,
        use_acrf_summary=use_acrf_summary,
        overwrite=overwrite,
    )


def run_clear_stage(
    *,
    study_id: str,
    stage: Literal["extraction", "step1", "step2"],
    output_dir: Path,
    clear_blob: bool,
) -> None:
    """Delete local artifacts (and optionally blob artifacts) for one stage."""
    if stage == "extraction":
        targets = [
            paths.local_extraction_layout(study_id, "protocol", output_dir),
            paths.local_extraction_layout(study_id, "acrf", output_dir),
            paths.local_extraction_opendataloader(study_id, "protocol", output_dir),
            paths.local_extraction_opendataloader(study_id, "acrf", output_dir),
        ]
        blob_prefixes = [
            paths.extraction_layout_prefix(study_id, "protocol"),
            paths.extraction_layout_prefix(study_id, "acrf"),
        ]
    elif stage == "step1":
        targets = [paths.local_protocol_sections_step1_dir(study_id, output_dir)]
        blob_prefixes = [f"{paths.protocol_sections_blob_prefix(study_id)}/step1/"]
    elif stage == "step2":
        targets = [paths.local_pipeline_step2_dir(study_id, output_dir)]
        blob_prefixes = [f"{paths.pipeline_step2_blob_prefix(study_id)}/"]
    else:
        raise typer.BadParameter(f"Unsupported stage: {stage}")

    removed = 0
    for target in targets:
        if target.exists():
            if target.is_dir():
                shutil.rmtree(target)
            else:
                target.unlink()
            removed += 1
            print(f"Removed {target}")
        else:
            print(f"Skip (missing): {target}")

    if not removed:
        print(
            f"No {stage} outputs found for study_id={study_id!r} under {output_dir}."
        )
    if not clear_blob:
        return

    bs = blob_io.blob_service_from_env()
    container = blob_io.container_from_env()
    blob_names: List[str] = []
    for prefix in blob_prefixes:
        names = blob_io.list_blob_names_with_prefix(
            blob_service=bs,
            container_name=container,
            prefix=prefix,
        )
        blob_names.extend(names)

    if not blob_names:
        print(f"No blob {stage} outputs found for study_id={study_id!r}.")
        return

    deleted = blob_io.delete_blobs(
        blob_service=bs,
        container_name=container,
        blob_paths=blob_names,
    )
    print(
        f"Deleted {deleted}/{len(blob_names)} blob object(s) "
        f"for stage={stage!r} in container {container!r}."
    )


def run_step2_merge(
    *,
    study_id: str,
    output_dir: Path,
    upload: bool,
    use_acrf_summary: bool = True,
    overwrite: bool = True,
) -> Path:
    """Merge and semantic-dedup all Step 1 section outputs into one Step 2 artifact."""
    _load_env()
    if overwrite:
        run_clear_stage(
            study_id=study_id,
            stage="step2",
            output_dir=output_dir,
            clear_blob=False,
        )
    step1_dir = paths.local_protocol_sections_step1_dir(study_id, output_dir)
    if not step1_dir.is_dir():
        raise typer.BadParameter(
            f"Missing {step1_dir}. Run `pdcheck protocol sections extract --study-id {study_id} --all` first."
        )
    step1_files = sorted(step1_dir.glob("*.json"))
    if not step1_files:
        raise typer.BadParameter(f"No Step 1 JSON files found under {step1_dir}.")

    step1_schema = load_schema("protocol_section_step1.schema.json")
    step1_objects = []
    for path in step1_files:
        obj = read_json(path)
        errs = validate(obj, step1_schema)
        if errs:
            raise typer.BadParameter(
                f"Step 1 file failed schema validation: {path} :: {'; '.join(errs[:5])}"
            )
        step1_objects.append(obj)

    _, acrf_summary_context = _load_acrf_contexts(
        study_id=study_id,
        output_dir=output_dir,
        include_acrf=True,
        use_acrf_summary=use_acrf_summary,
        caller="step2-dedup",
    )
    merged = step2_merge.merge_step1_outputs(
        study_id=study_id,
        step1_objects=step1_objects,
        acrf_summary_context=acrf_summary_context,
    )
    step2_schema = load_schema("protocol_sections_step2_merged.schema.json")
    out_errs = validate(merged, step2_schema)
    if out_errs:
        raise typer.BadParameter(
            "Step 2 output failed schema validation: " + "; ".join(out_errs[:10])
        )

    out_path = paths.local_protocol_sections_step2_merged(study_id, output_dir)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    write_json(out_path, merged)
    print(f"Wrote {out_path}")
    _upload_if_enabled(
        out_path,
        paths.protocol_sections_step2_merged_blob(study_id),
        upload=upload,
        content_type="application/json",
    )
    return out_path


def run_step2_export_review(
    *,
    study_id: str,
    output_dir: Path,
    workbook: Optional[Path],
    upload: bool,
) -> Path:
    _load_env()
    step2_path = paths.local_protocol_sections_step2_merged(study_id, output_dir)
    if not step2_path.is_file():
        raise typer.BadParameter(
            f"Missing {step2_path}. Run `pdcheck step2 --study-id {study_id}` first."
        )
    workbook_path = workbook or paths.local_protocol_sections_step2_review_workbook(
        study_id, output_dir
    )
    workbook_path.parent.mkdir(parents=True, exist_ok=True)
    out = step2_review.export_step2_review_workbook(
        step2_json_path=step2_path,
        workbook_path=workbook_path,
    )
    print(f"Wrote {out}")
    _upload_if_enabled(
        out,
        paths.protocol_sections_step2_review_workbook_blob(study_id),
        upload=upload,
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    return out


def _context_from_sections(*, study_id: str, output_dir: Path, section_ids: List[str]) -> str:
    raw_dir = paths.local_protocol_sections_raw_dir(study_id, output_dir)
    chunks: List[str] = []
    for sid in sorted(set(section_ids)):
        safe = sid.replace(":", "_")
        path = raw_dir / f"{safe}.md"
        if not path.is_file():
            continue
        chunks.append(path.read_text(encoding="utf-8"))
    if chunks:
        return "\n\n---\n\n".join(chunks)
    return _read_protocol_source_md(study_id, output_dir).read_text(encoding="utf-8")


def run_step2_apply_review(
    *,
    study_id: str,
    output_dir: Path,
    workbook: Path,
    context_mode: Literal["full_protocol", "sections_only"],
    strict: bool,
    upload: bool,
    use_acrf_summary: bool = True,
) -> None:
    _load_env()
    step2_path = paths.local_protocol_sections_step2_merged(study_id, output_dir)
    if not step2_path.is_file():
        raise typer.BadParameter(
            f"Missing {step2_path}. Run `pdcheck step2 --study-id {study_id}` first."
        )
    if not workbook.is_file():
        raise typer.BadParameter(f"Workbook not found: {workbook}")
    step2_obj = read_json(step2_path)
    review_rows = step2_review.read_step2_review_workbook(workbook)

    full_protocol = _read_protocol_source_md(study_id, output_dir).read_text(encoding="utf-8")
    _, acrf_summary_context = _load_acrf_contexts(
        study_id=study_id,
        output_dir=output_dir,
        include_acrf=True,
        use_acrf_summary=use_acrf_summary,
        caller="step2-revalidate",
    )

    def _revalidate(rule: dict, deviation: dict, dm_comments: str) -> List[dict]:
        if context_mode == "full_protocol":
            protocol_context = full_protocol
        else:
            protocol_context = _context_from_sections(
                study_id=study_id,
                output_dir=output_dir,
                section_ids=list(deviation.get("source_section_ids", [])),
            )
        return llm_mod.revalidate_deviation_with_dm_feedback(
            study_id=study_id,
            rule=rule,
            deviation=deviation,
            dm_comments=dm_comments,
            protocol_context=protocol_context,
            context_mode=context_mode,
            acrf_summary_context=acrf_summary_context,
        )

    final_obj, audit_obj, final_rows = step2_review.apply_review_and_finalize(
        step2_obj=step2_obj,
        review_rows=review_rows,
        revalidate_deviation=_revalidate,
        strict=strict,
    )

    final_json_path = paths.local_protocol_sections_step2_validated(study_id, output_dir)
    audit_json_path = paths.local_protocol_sections_step2_validation_audit(
        study_id, output_dir
    )
    final_json_path.parent.mkdir(parents=True, exist_ok=True)
    step2_review.write_finalized_step2_outputs(
        final_obj=final_obj,
        audit_obj=audit_obj,
        final_json_path=final_json_path,
        audit_json_path=audit_json_path,
    )
    print(f"Wrote {final_json_path}")
    print(f"Wrote {audit_json_path}")
    reviewed_workbook = paths.local_dm_review_workbook(study_id, output_dir)
    step2_review.write_final_review_workbook(
        output_workbook=reviewed_workbook,
        rows=final_rows,
    )
    print(f"Wrote {reviewed_workbook}")

    _upload_if_enabled(
        final_json_path,
        paths.protocol_sections_step2_validated_blob(study_id),
        upload=upload,
        content_type="application/json",
    )
    _upload_if_enabled(
        audit_json_path,
        paths.protocol_sections_step2_validation_audit_blob(study_id),
        upload=upload,
        content_type="application/json",
    )
    _upload_if_enabled(
        reviewed_workbook,
        paths.dm_review_workbook_blob(study_id),
        upload=upload,
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


@app.command("rules")
def cmd_rules(
    study_id: str = typer.Option(..., "--study-id", envvar="STUDY_ID"),
    output_dir: Path = typer.Option(Path("output"), "--output-dir", "-o"),
    upload: bool = typer.Option(True, "--upload/--no-upload"),
    keep_di_page_markers: bool = typer.Option(
        False,
        "--keep-di-page-markers",
        help="Keep DI PageHeader/PageFooter/PageNumber/PageBreak HTML comments in markdown.",
    ),
    rollup_to_level: int = typer.Option(
        1,
        "--rollup-to-level",
        min=1,
        max=6,
        help="Max ATX depth for manifest sections (1=# only … 6=######). Deeper headings roll into parent body. Use 6 for legacy one-section-per-heading behavior.",
    ),
    use_acrf_summary: bool = typer.Option(
        True,
        "--use-acrf-summary/--no-use-acrf-summary",
        help="Attach merged aCRF summary context when available.",
    ),
    overwrite: bool = typer.Option(
        True,
        "--overwrite/--no-overwrite",
        help="Before Step 1 extract, remove existing local Step 1 JSON under pipeline/.../protocol_sections/step1/.",
    ),
) -> None:
    """Segment protocol and run Step 1 extraction on every section (shortcut)."""
    run_rules(
        study_id=study_id,
        output_dir=output_dir,
        upload=upload,
        strip_page_markers=not keep_di_page_markers,
        rollup_max_section_level=rollup_to_level,
        use_acrf_summary=use_acrf_summary,
        overwrite=overwrite,
    )


@app.command("clear-stage")
def cmd_clear_stage(
    study_id: str = typer.Option(..., "--study-id", envvar="STUDY_ID"),
    stage: Literal["extraction", "step1", "step2"] = typer.Option(
        ...,
        "--stage",
        help="Pipeline stage outputs to clear: extraction, step1, or step2.",
    ),
    clear_blob: bool = typer.Option(
        False,
        "--blob",
        help="Also clear corresponding blob outputs for the selected stage.",
    ),
    output_dir: Path = typer.Option(Path("output"), "--output-dir", "-o"),
) -> None:
    """Delete local outputs for a selected pipeline stage."""
    _load_env()
    run_clear_stage(
        study_id=study_id,
        stage=stage,
        output_dir=output_dir,
        clear_blob=clear_blob,
    )


@app.command("step2")
def cmd_step2(
    study_id: str = typer.Option(..., "--study-id", envvar="STUDY_ID"),
    output_dir: Path = typer.Option(Path("output"), "--output-dir", "-o"),
    upload: bool = typer.Option(True, "--upload/--no-upload"),
    use_acrf_summary: bool = typer.Option(
        True,
        "--use-acrf-summary/--no-use-acrf-summary",
        help="Attach merged aCRF summary context to dedup LLM prompts when available.",
    ),
    overwrite: bool = typer.Option(
        True,
        "--overwrite/--no-overwrite",
        help="Before merge, remove existing local Step 2 outputs under pipeline/.../step2/.",
    ),
) -> None:
    """Merge Step 1 section outputs and deduplicate semantic duplicates."""
    run_step2_merge(
        study_id=study_id,
        output_dir=output_dir,
        upload=upload,
        use_acrf_summary=use_acrf_summary,
        overwrite=overwrite,
    )


@app.command("step2-export-review")
def cmd_step2_export_review(
    study_id: str = typer.Option(..., "--study-id", envvar="STUDY_ID"),
    output_dir: Path = typer.Option(Path("output"), "--output-dir", "-o"),
    workbook: Optional[Path] = typer.Option(
        None, "--workbook", "-w", help="Destination workbook path (.xlsx)."
    ),
    upload: bool = typer.Option(True, "--upload/--no-upload"),
) -> None:
    """Export Step 2 merged deviations to DM review workbook."""
    run_step2_export_review(
        study_id=study_id,
        output_dir=output_dir,
        workbook=workbook,
        upload=upload,
    )


@app.command("step2-apply-review")
def cmd_step2_apply_review(
    study_id: str = typer.Option(..., "--study-id", envvar="STUDY_ID"),
    workbook: Path = typer.Option(..., "--workbook", "-w", help="Reviewed workbook path"),
    output_dir: Path = typer.Option(Path("output"), "--output-dir", "-o"),
    context_mode: Literal["full_protocol", "sections_only"] = typer.Option(
        "full_protocol",
        "--context-mode",
        help="Protocol context for revalidation prompt.",
    ),
    strict: bool = typer.Option(
        False,
        "--strict",
        help="Fail if any revalidation rows remain unresolved or invalid.",
    ),
    upload: bool = typer.Option(True, "--upload/--no-upload"),
    use_acrf_summary: bool = typer.Option(
        True,
        "--use-acrf-summary/--no-use-acrf-summary",
        help="Attach merged aCRF summary context to revalidation prompts when available.",
    ),
) -> None:
    """Apply reviewed DM workbook and produce validated Step 2 outputs."""
    run_step2_apply_review(
        study_id=study_id,
        output_dir=output_dir,
        workbook=workbook,
        context_mode=context_mode,
        strict=strict,
        upload=upload,
        use_acrf_summary=use_acrf_summary,
    )


@protocol_app.command("segment")
def cmd_protocol_segment(
    study_id: str = typer.Option(..., "--study-id", envvar="STUDY_ID"),
    output_dir: Path = typer.Option(Path("output"), "--output-dir", "-o"),
    upload: bool = typer.Option(True, "--upload/--no-upload"),
    keep_di_page_markers: bool = typer.Option(
        False,
        "--keep-di-page-markers",
        help="Keep DI PageHeader/PageFooter/PageNumber/PageBreak HTML comments in markdown.",
    ),
    rollup_to_level: int = typer.Option(
        1,
        "--rollup-to-level",
        min=1,
        max=6,
        help="Max ATX depth for manifest sections (1=# only … 6=######). Deeper headings roll into parent body. Use 6 for legacy one-section-per-heading behavior.",
    ),
) -> None:
    """Build sections_manifest.json from protocol source.md."""
    _load_env()
    run_protocol_segment(
        study_id=study_id,
        output_dir=output_dir,
        upload=upload,
        strip_page_markers=not keep_di_page_markers,
        rollup_max_section_level=rollup_to_level,
    )


@sections_app.command("list")
def cmd_protocol_sections_list(
    study_id: str = typer.Option(..., "--study-id", envvar="STUDY_ID"),
    output_dir: Path = typer.Option(Path("output"), "--output-dir", "-o"),
) -> None:
    """List section_id, heading level, and path for each section."""
    man_path = paths.local_protocol_sections_manifest(study_id, output_dir)
    if not man_path.exists():
        raise typer.BadParameter(
            f"Missing {man_path}. Run `pdcheck protocol segment` first."
        )
    manifest = load_manifest(man_path)
    for sec in manifest.get("sections", []):
        path_str = " > ".join(sec.get("section_path", []))
        n = len(sec.get("sentences", []))
        print(
            f"{sec.get('section_id')}\tlvl={sec.get('heading_level')}\tsentences={n}\t{path_str}"
        )


@sections_app.command("preview")
def cmd_protocol_sections_preview(
    study_id: str = typer.Option(..., "--study-id", envvar="STUDY_ID"),
    output_dir: Path = typer.Option(Path("output"), "--output-dir", "-o"),
    section_id: Optional[List[str]] = typer.Option(
        None,
        "--section-id",
        help="Repeat to select multiple sections.",
    ),
    match_regex: Optional[str] = typer.Option(
        None,
        "--match-regex",
        help="Select sections whose joined path matches this regex.",
    ),
) -> None:
    """Print numbered sentences as sent to the Step 1 model."""
    man_path = paths.local_protocol_sections_manifest(study_id, output_dir)
    if not man_path.exists():
        raise typer.BadParameter(
            f"Missing {man_path}. Run `pdcheck protocol segment` first."
        )
    manifest = load_manifest(man_path)
    sid_list = section_id or []
    if not sid_list and not match_regex:
        raise typer.BadParameter("Pass --section-id and/or --match-regex.")
    try:
        ids = select_section_ids(
            manifest,
            all_sections=False,
            section_ids=sid_list,
            match_regex=match_regex,
            skip_section_ids=[],
            skip_regex=None,
        )
    except ValueError as ex:
        raise typer.BadParameter(str(ex)) from ex
    for cid in ids:
        sec = get_section_by_id(manifest, cid)
        assert sec is not None
        print("=" * 72)
        print(format_section_for_prompt(sec))
        print()


@sections_app.command("extract")
def cmd_protocol_sections_extract(
    study_id: str = typer.Option(..., "--study-id", envvar="STUDY_ID"),
    output_dir: Path = typer.Option(Path("output"), "--output-dir", "-o"),
    upload: bool = typer.Option(True, "--upload/--no-upload"),
    all_sections: bool = typer.Option(
        False,
        "--all",
        help="Process every section (respect skips).",
    ),
    section_id: Optional[List[str]] = typer.Option(
        None,
        "--section-id",
        help="Repeat to select multiple sections.",
    ),
    match_regex: Optional[str] = typer.Option(
        None,
        "--match-regex",
        help="Select sections whose joined path matches this regex.",
    ),
    skip_section_id: Optional[List[str]] = typer.Option(
        None,
        "--skip-section-id",
        help="Repeat to skip section ids.",
    ),
    skip_regex: Optional[str] = typer.Option(
        None,
        "--skip-regex",
        help="Skip sections whose joined path matches this regex.",
    ),
    no_acrf: bool = typer.Option(
        False,
        "--no-acrf",
        help="Do not append aCRF context to prompts.",
    ),
    use_acrf_summary: bool = typer.Option(
        True,
        "--use-acrf-summary/--no-use-acrf-summary",
        help="Attach merged aCRF summary context when available.",
    ),
    overwrite: bool = typer.Option(
        True,
        "--overwrite/--no-overwrite",
        help="Before extract, remove existing local Step 1 JSON under pipeline/.../protocol_sections/step1/.",
    ),
) -> None:
    """Run Step 1 LLM extraction for selected sections."""
    _load_env()
    sid_list = section_id or []
    sk_list = skip_section_id or []
    if not all_sections and not sid_list and not match_regex:
        raise typer.BadParameter(
            "Select sections with --all, --section-id, and/or --match-regex."
        )
    run_protocol_sections_extract(
        study_id=study_id,
        output_dir=output_dir,
        upload=upload,
        all_sections=all_sections,
        section_id=sid_list,
        match_regex=match_regex,
        skip_section_id=sk_list,
        skip_regex=skip_regex,
        include_acrf=not no_acrf,
        use_acrf_summary=use_acrf_summary,
        overwrite=overwrite,
    )


@acrf_app.command("split-toc")
def cmd_acrf_split_toc(
    study_id: str = typer.Option(..., "--study-id", envvar="STUDY_ID"),
    output_dir: Path = typer.Option(Path("output"), "--output-dir", "-o"),
    source_md: Optional[Path] = typer.Option(
        None,
        "--source-md",
        help="Path to aCRF source markdown (default output/<study-id>/extractions/acrf/layout/rendered/source.md).",
    ),
    destination_dir: Optional[Path] = typer.Option(
        None,
        "--destination-dir",
        help="Directory for split TOC section markdown files.",
    ),
    no_manifest: bool = typer.Option(
        False,
        "--no-manifest",
        help="Skip writing sections_manifest.json.",
    ),
) -> None:
    """Split aCRF markdown into TOC-listed section files."""
    src = source_md or _read_acrf_source_md(study_id, output_dir)
    if not src.is_file():
        raise typer.BadParameter(f"source markdown not found: {src}")
    dest = destination_dir or (src.parent / "sections_toc")
    count, manifest_path = run_acrf_split_toc(
        source_md=src,
        destination_dir=dest,
        write_manifest=not no_manifest,
    )
    print(f"Wrote {count} section files to {dest}")
    if not no_manifest:
        print(f"Wrote {manifest_path}")


@acrf_app.command("summarize-sections")
def cmd_acrf_summarize_sections(
    study_id: str = typer.Option(..., "--study-id", envvar="STUDY_ID"),
    output_dir: Path = typer.Option(Path("output"), "--output-dir", "-o"),
    source_dir: Optional[Path] = typer.Option(
        None,
        "--source-dir",
        help="Directory with split TOC markdown files (default extraction aCRF rendered/sections_toc).",
    ),
    upload: bool = typer.Option(True, "--upload/--no-upload"),
) -> None:
    """Run LLM summary for each split aCRF section markdown file."""
    run_acrf_summarize_sections(
        study_id=study_id,
        output_dir=output_dir,
        upload=upload,
        source_dir=source_dir,
    )


@acrf_app.command("merge-summaries")
def cmd_acrf_merge_summaries(
    study_id: str = typer.Option(..., "--study-id", envvar="STUDY_ID"),
    output_dir: Path = typer.Option(Path("output"), "--output-dir", "-o"),
    upload: bool = typer.Option(True, "--upload/--no-upload"),
) -> None:
    """Merge all per-section aCRF summaries into one artifact."""
    run_acrf_merge_summaries(study_id=study_id, output_dir=output_dir, upload=upload)


@acrf_app.command("summarize")
def cmd_acrf_summarize(
    study_id: str = typer.Option(..., "--study-id", envvar="STUDY_ID"),
    output_dir: Path = typer.Option(Path("output"), "--output-dir", "-o"),
    upload: bool = typer.Option(True, "--upload/--no-upload"),
) -> None:
    """Shortcut: summarize aCRF sections and merge outputs."""
    run_acrf_summarize(study_id=study_id, output_dir=output_dir, upload=upload)


app.add_typer(protocol_app, name="protocol")
app.add_typer(acrf_app, name="acrf")
app.add_typer(ui_app, name="ui")
app.add_typer(v2_app, name="v2")


@ui_app.command("review")
def cmd_ui_review(
    study_id: str = typer.Option(..., "--study-id", envvar="STUDY_ID"),
    output_dir: Path = typer.Option(Path("output"), "--output-dir", "-o"),
    host: str = typer.Option("127.0.0.1", "--host"),
    port: int = typer.Option(8766, "--port", min=1, max=65535),
) -> None:
    """Start local Streamlit UI for Pipeline V2 review cycles."""
    try:
        import streamlit  # noqa: F401
    except ImportError as ex:
        raise typer.BadParameter('Install UI dependencies: pip install -e ".[ui]"') from ex
    ui_script = Path(__file__).resolve().parent / "ui_v2_review_streamlit.py"
    cmd = [
        sys.executable,
        "-m",
        "streamlit",
        "run",
        str(ui_script),
        "--server.address",
        host,
        "--server.port",
        str(port),
        "--",
        "--study-id",
        study_id,
        "--output-dir",
        str(output_dir),
    ]
    raise SystemExit(subprocess.call(cmd))


@v2_app.command("run")
def cmd_v2_run(
    study_id: str = typer.Option(..., "--study-id", envvar="STUDY_ID"),
    output_dir: Path = typer.Option(Path("output"), "--output-dir", "-o"),
    from_step: int = typer.Option(1, "--from-step", min=1, max=10),
    to_step: int = typer.Option(10, "--to-step", min=1, max=10),
    step_range: Optional[str] = typer.Option(
        None,
        "--step-range",
        help="Alternative range syntax like 1..5 or 4..10.",
    ),
) -> None:
    """Run V2 pipeline in a step range (for example, 1..2, 1..5, 4..10)."""
    _load_env()
    if step_range:
        m = re.match(r"^\s*(\d+)\s*\.\.\s*(\d+)\s*$", step_range)
        if not m:
            raise typer.BadParameter("Invalid --step-range format. Use N..M (for example 1..5).")
        from_step = int(m.group(1))
        to_step = int(m.group(2))
    pipeline_v2.run_steps(
        study_id=study_id,
        output_dir=output_dir,
        from_step=from_step,
        to_step=to_step,
    )


@app.command("run-all")
def cmd_run_all(
    study_id: str = typer.Option(..., "--study-id", envvar="STUDY_ID"),
    output_dir: Path = typer.Option(Path("output"), "--output-dir", "-o"),
    skip_acrf: bool = typer.Option(False, "--skip-acrf"),
    upload: bool = typer.Option(True, "--upload/--no-upload"),
    use_acrf_summary: bool = typer.Option(
        True,
        "--use-acrf-summary/--no-use-acrf-summary",
        help="Attach merged aCRF summary context to downstream LLM prompts when available.",
    ),
    overwrite: bool = typer.Option(
        True,
        "--overwrite/--no-overwrite",
        help="Before Step 1 extract in run-all, remove existing local Step 1 outputs (same as protocol sections extract).",
    ),
) -> None:
    """extract → aCRF summarize → protocol segment + Step 1 extract for all sections."""
    if skip_acrf:
        raise typer.BadParameter("run-all requires aCRF; do not pass --skip-acrf.")
    run_extract(
        study_id=study_id,
        protocol_blob=None,
        acrf_blob=None,
        output_dir=output_dir,
        model_id=None,
        sas_ttl=int(os.getenv("DI_SAS_TTL_MINUTES", "15")),
        upload=upload,
        skip_acrf=False,
        upload_only=False,
        run_opendataloader_ocr=True,
        opendataloader_only=False,
        debug_blob=False,
    )
    run_acrf_split_toc(
        source_md=_read_acrf_source_md(study_id, output_dir),
        destination_dir=_default_acrf_toc_dir(study_id, output_dir),
        write_manifest=True,
    )
    run_acrf_summarize(study_id=study_id, output_dir=output_dir, upload=upload)
    run_rules(
        study_id=study_id,
        output_dir=output_dir,
        upload=upload,
        use_acrf_summary=use_acrf_summary,
        overwrite=overwrite,
    )
    print("run-all complete through Step 1 extraction with aCRF summary context.")


def main() -> None:
    app()


if __name__ == "__main__":
    main()

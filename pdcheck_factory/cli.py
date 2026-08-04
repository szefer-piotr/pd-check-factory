"""Typer CLI for the Azure MVP pipeline."""

from __future__ import annotations

import os
import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Dict, List, Literal, Optional, Tuple

import typer
from dotenv import load_dotenv

from pdcheck_factory import blob_io, di_layout, opendataloader_ocr, paths, pipeline_v2
from pdcheck_factory import cost_usage
from pdcheck_factory import llm as llm_mod
from pdcheck_factory.json_util import load_schema, read_json, validate, write_json
from pdcheck_factory.ui_step_api import run_step_api
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
ui_app = typer.Typer(help="UI commands for React Step API.", no_args_is_help=True)
v2_app = typer.Typer(help="Pipeline V2 runner (paragraph anchors, staged reviews).", no_args_is_help=True)

_TOC_ROW = re.compile(
    r"<tr>\s*<td>(.*?)</td>\s*<td>(.*?)</td>\s*</tr>",
    re.IGNORECASE | re.DOTALL,
)
_TOC_CODE = re.compile(r"\(([^)]+)\)\s*$")
_PAGE_HEADER = re.compile(r"^Page:\s*(.+)$")
_PAGE_CODE = re.compile(r"\(([^)]+)\)")
_PAGE_NUMBER = re.compile(r'<!--\s*PageNumber\s*=\s*"Page\s+(\d+)\s+of\s+\d+\s+pages"\s*-->')
_HTML_TABLE = re.compile(r"<table\b[^>]*>(.*?)</table>", re.IGNORECASE | re.DOTALL)
_HTML_ROW = re.compile(r"<tr\b[^>]*>(.*?)</tr>", re.IGNORECASE | re.DOTALL)
_HTML_CELL = re.compile(r"<t[hd]\b[^>]*>(.*?)</t[hd]>", re.IGNORECASE | re.DOTALL)
_FORM_OID_RE = re.compile(r"^[A-Z][A-Z0-9]{0,7}$")
_FORM_HEADING_RE = re.compile(
    r"^(?:#{1,6}\s*)?([A-Z][A-Z0-9]{0,7})\s*[-–—]\s*(.+?)\s*$"
)


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


def _html_cell_text(raw: str) -> str:
    return " ".join(re.sub(r"<[^>]+>", " ", raw).split()).strip()


def _parse_acrf_toc_rows(page_marker: str) -> List[Dict[str, object]]:
    toc: List[Dict[str, object]] = []
    for raw_name, raw_page in _TOC_ROW.findall(page_marker):
        name = " ".join(raw_name.split())
        page_txt = raw_page.strip()
        if not page_txt.isdigit():
            continue
        page_no = int(page_txt)
        m_code = _TOC_CODE.search(name)
        code = m_code.group(1) if m_code else ""
        toc.append({"name": name, "code": code, "toc_page": page_no})
    return toc


def _parse_acrf_form_inventory(text: str) -> List[Dict[str, object]]:
    """Parse Form OID / Form name rows from the first aCRF form-inventory HTML table."""
    for table_html in _HTML_TABLE.findall(text):
        oid_idx: Optional[int] = None
        name_idx: Optional[int] = None
        inventory: List[Dict[str, object]] = []
        for row_html in _HTML_ROW.findall(table_html):
            cells = [_html_cell_text(c) for c in _HTML_CELL.findall(row_html)]
            if not cells:
                continue
            lowered = [c.casefold() for c in cells]
            if oid_idx is None:
                if "form oid" in lowered and "form name" in lowered:
                    oid_idx = lowered.index("form oid")
                    name_idx = lowered.index("form name")
                continue
            assert oid_idx is not None and name_idx is not None
            if oid_idx >= len(cells) or name_idx >= len(cells):
                continue
            code = cells[oid_idx].strip().upper()
            name = cells[name_idx].strip()
            if not code or not name or not _FORM_OID_RE.match(code):
                continue
            inventory.append({"name": f"{name} ({code})", "code": code})
        if inventory:
            return inventory
    return []


def _find_form_section_start(lines: List[str], code: str, _name: str) -> Optional[int]:
    """Locate the first body start for a form OID (heading, plain title, or Page:)."""
    code_u = code.upper()
    for i, line in enumerate(lines, start=1):
        stripped = line.rstrip("\n").strip()
        m = _FORM_HEADING_RE.match(stripped)
        if m and m.group(1).upper() == code_u:
            return i
    for i, line in enumerate(lines, start=1):
        ph = _PAGE_HEADER.match(line.rstrip("\n"))
        if not ph:
            continue
        m_code = _PAGE_CODE.search(ph.group(1))
        if m_code and m_code.group(1).upper() == code_u:
            return i
    return None


def _assign_section_boundaries(
    rows: List[Dict[str, object]],
    *,
    start_lookup: Callable[[Dict[str, object]], Optional[int]],
    total_lines: int,
) -> List[Dict[str, object]]:
    out_rows: List[Dict[str, object]] = []
    starts: List[Optional[int]] = [start_lookup(row) for row in rows]
    for idx, row in enumerate(rows):
        start = starts[idx]
        if start is None:
            continue
        next_start: Optional[int] = None
        for nxt in starts[idx + 1 :]:
            if nxt is not None and nxt > start:
                next_start = nxt
                break
        out = dict(row)
        out["start_line"] = start
        out["end_line"] = (next_start - 1) if next_start is not None else total_lines
        out_rows.append(out)
    return out_rows


def _write_acrf_sections(
    *,
    source_md: Path,
    destination_dir: Path,
    lines: List[str],
    out_rows: List[Dict[str, object]],
    write_manifest: bool,
    split_strategy: str,
    total_lines: int,
) -> Tuple[int, Path]:
    for row in out_rows:
        if row.get("end_line") is None:
            row["end_line"] = total_lines

    destination_dir.mkdir(parents=True, exist_ok=True)
    written = 0
    for seq, row in enumerate(out_rows, start=1):
        name = str(row["name"])
        code = str(row["code"])
        page = int(row["toc_page"]) if row.get("toc_page") is not None else seq
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
            "split_strategy": split_strategy,
            "sections": out_rows,
        }
        write_json(manifest_path, manifest)

    return written, manifest_path


def run_acrf_split_toc(
    *,
    source_md: Path,
    destination_dir: Path,
    write_manifest: bool,
) -> Tuple[int, Path]:
    text = source_md.read_text(encoding="utf-8")
    lines = text.splitlines(keepends=True)
    total_lines = len(lines)

    page_marker = "\n".join(lines[:300])
    toc = _parse_acrf_toc_rows(page_marker)

    if toc:
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

        sorted_toc = sorted(toc, key=lambda x: int(x["toc_page"]))

        def _toc_start(row: Dict[str, object]) -> Optional[int]:
            code = str(row["code"])
            toc_page = int(row["toc_page"])
            return starts_by_code.get(code) or starts_by_page.get(toc_page)

        out_rows = _assign_section_boundaries(
            sorted_toc, start_lookup=_toc_start, total_lines=total_lines
        )
        if not out_rows:
            raise typer.BadParameter("Could not determine section boundaries from TOC.")
        return _write_acrf_sections(
            source_md=source_md,
            destination_dir=destination_dir,
            lines=lines,
            out_rows=out_rows,
            write_manifest=write_manifest,
            split_strategy="toc",
            total_lines=total_lines,
        )

    # Fallback: form inventory (aCRFs without a page TOC).
    inventory = _parse_acrf_form_inventory(text)
    if not inventory:
        raise typer.BadParameter(
            f"No TOC rows and no form inventory found in {source_md}."
        )

    def _inv_start(row: Dict[str, object]) -> Optional[int]:
        code = str(row["code"])
        raw_name = str(row["name"])
        m = _TOC_CODE.search(raw_name)
        form_name = raw_name[: m.start()].strip() if m else raw_name
        return _find_form_section_start(lines, code, form_name)

    out_rows = _assign_section_boundaries(
        inventory, start_lookup=_inv_start, total_lines=total_lines
    )
    if not out_rows:
        raise typer.BadParameter(
            "Could not determine section boundaries from form inventory."
        )
    return _write_acrf_sections(
        source_md=source_md,
        destination_dir=destination_dir,
        lines=lines,
        out_rows=out_rows,
        write_manifest=write_manifest,
        split_strategy="form_inventory",
        total_lines=total_lines,
    )


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
    skip_protocol: bool,
    upload_only: bool,
    run_opendataloader_ocr: bool,
    opendataloader_only: bool,
    debug_blob: bool = False,
    log_callback: Optional[Callable[[str], None]] = None,
) -> None:
    """Run extraction for protocol (+ optional aCRF) PDFs in Blob."""

    def _log(message: str) -> None:
        if log_callback is not None:
            log_callback(message)

    _load_env()
    if skip_acrf and skip_protocol:
        raise typer.BadParameter("Cannot use --skip-acrf and --skip-protocol together.")
    if upload_only and not upload:
        raise typer.BadParameter("--upload-only cannot be used with --no-upload.")
    if upload_only and opendataloader_only:
        raise typer.BadParameter("--upload-only cannot be used with --opendataloader-only.")
    if opendataloader_only and not run_opendataloader_ocr:
        raise typer.BadParameter(
            "--opendataloader-only requires --opendataloader-ocr (or omit --no-opendataloader-ocr)."
        )

    cost_cm = cost_usage.session(study_id, output_dir, step="extract-inputs")
    cost_cm.__enter__()
    try:
        _run_extract_work(
            study_id=study_id,
            protocol_blob=protocol_blob,
            acrf_blob=acrf_blob,
            output_dir=output_dir,
            model_id=model_id,
            sas_ttl=sas_ttl,
            upload=upload,
            skip_acrf=skip_acrf,
            skip_protocol=skip_protocol,
            upload_only=upload_only,
            run_opendataloader_ocr=run_opendataloader_ocr,
            opendataloader_only=opendataloader_only,
            debug_blob=debug_blob,
            log_callback=log_callback,
            _log=_log,
        )
    finally:
        try:
            cost_usage.print_cost_summary(cost_usage.load_artifact(study_id, output_dir))
        except Exception:  # noqa: BLE001
            pass
        cost_cm.__exit__(None, None, None)


def _run_extract_work(
    *,
    study_id: str,
    protocol_blob: Optional[str],
    acrf_blob: Optional[str],
    output_dir: Path,
    model_id: Optional[str],
    sas_ttl: int,
    upload: bool,
    skip_acrf: bool,
    skip_protocol: bool,
    upload_only: bool,
    run_opendataloader_ocr: bool,
    opendataloader_only: bool,
    debug_blob: bool,
    log_callback: Optional[Callable[[str], None]],
    _log: Callable[[str], None],
) -> None:
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
        if not skip_protocol:
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

        if debug_blob and not skip_protocol:
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
        _log("Extractor mode: OpenDataLoader only")
        if not skip_protocol:
            if not blob_io.blob_exists(
                blob_service=bs, container_name=container, blob_path=protocol_resolved
            ):
                raise typer.BadParameter(
                    f"Protocol blob not found: {protocol_resolved} (container {container})"
                )
            _log("OpenDataLoader: protocol — starting")
            opendataloader_ocr.run_ocr_for_blob(
                doc_role="protocol",
                source_blob_path=protocol_resolved,
                local_output_base=paths.local_extraction_opendataloader(
                    study_id, "protocol", output_dir
                ),
                blob_service=bs,
                container_name=container,
            )
            _log("OpenDataLoader: protocol complete")
        if skip_acrf:
            return
        if not blob_io.blob_exists(
            blob_service=bs, container_name=container, blob_path=acrf_resolved
        ):
            raise typer.BadParameter(
                f"aCRF blob not found: {acrf_resolved}. Upload it or pass --skip-acrf."
            )
        _log("OpenDataLoader: aCRF — starting")
        opendataloader_ocr.run_ocr_for_blob(
            doc_role="acrf",
            source_blob_path=acrf_resolved,
            local_output_base=paths.local_extraction_opendataloader(
                study_id, "acrf", output_dir
            ),
            blob_service=bs,
            container_name=container,
        )
        _log("OpenDataLoader: aCRF complete")
        return

    cs = blob_io.require_env("STORAGE_CONNECTION_STRING")
    di_endpoint = blob_io.require_env("DI_ENDPOINT")
    di_key = blob_io.require_env("DI_KEY")

    if run_opendataloader_ocr:
        _log("Extractor mode: Document Intelligence + OpenDataLoader")
    else:
        _log("Extractor mode: Document Intelligence only")

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

    if not skip_protocol:
        if not blob_io.blob_exists(
            blob_service=bs, container_name=container, blob_path=protocol_resolved
        ):
            raise typer.BadParameter(
                f"Protocol blob not found: {protocol_resolved} (container {container})"
            )

        local_proto = paths.local_extraction_layout(study_id, "protocol", output_dir)
        _log("DI: analyzing protocol…")
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
            log_callback=log_callback,
        )
        _log("DI: protocol complete")
        if run_opendataloader_ocr:
            _log("OpenDataLoader: protocol — starting")
            opendataloader_ocr.run_ocr_for_blob(
                doc_role="protocol",
                source_blob_path=protocol_resolved,
                local_output_base=paths.local_extraction_opendataloader(
                    study_id, "protocol", output_dir
                ),
                blob_service=bs,
                container_name=container,
            )
            _log("OpenDataLoader: protocol complete")

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
    _log("DI: analyzing aCRF…")
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
        log_callback=log_callback,
    )
    _log("DI: aCRF complete")
    if run_opendataloader_ocr:
        _log("OpenDataLoader: aCRF — starting")
        opendataloader_ocr.run_ocr_for_blob(
            doc_role="acrf",
            source_blob_path=acrf_resolved,
            local_output_base=paths.local_extraction_opendataloader(
                study_id, "acrf", output_dir
            ),
            blob_service=bs,
            container_name=container,
        )
        _log("OpenDataLoader: aCRF complete")

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
    skip_protocol: bool = typer.Option(
        False, "--skip-protocol", help="Only extract aCRF (protocol run skipped)."
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
        skip_protocol=skip_protocol,
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
        print(
            f"[{caller}] Including full raw aCRF context: "
            f"{acrf_chars_total} chars."
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


def run_clear_stage(
    *,
    study_id: str,
    stage: Literal["extraction"],
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


@app.command("clear-stage")
def cmd_clear_stage(
    study_id: str = typer.Option(..., "--study-id", envvar="STUDY_ID"),
    stage: Literal["extraction"] = typer.Option(
        ...,
        "--stage",
        help="Pipeline stage outputs to clear: extraction.",
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


app.add_typer(protocol_app, name="protocol")
app.add_typer(acrf_app, name="acrf")
app.add_typer(ui_app, name="ui")
app.add_typer(v2_app, name="v2")

cost_app = typer.Typer(help="Cost usage analysis for LLM and Document Intelligence.", no_args_is_help=True)
app.add_typer(cost_app, name="cost")


@cost_app.command("show")
def cmd_cost_show(
    study_id: str = typer.Option(..., "--study-id", envvar="STUDY_ID"),
    output_dir: Path = typer.Option(Path("output"), "--output-dir", "-o"),
) -> None:
    """Print cumulative cost usage totals and per-step breakdown for a study."""
    path = paths.local_pipeline_cost_usage_json(study_id, output_dir)
    if not path.is_file():
        typer.echo(f"No cost usage artifact at {path}", err=True)
        raise typer.Exit(code=1)
    artifact = cost_usage.load_artifact(study_id, output_dir)
    cost_usage.print_cost_breakdown(artifact)



@ui_app.command("step-api")
def cmd_ui_step_api(
    host: str = typer.Option("127.0.0.1", "--host"),
    port: int = typer.Option(8787, "--port", min=1, max=65535),
    output_dir: Path = typer.Option(Path("output"), "--output-dir", "-o"),
) -> None:
    """Start local HTTP API for React step UI (upload + extract + preview)."""
    run_step_api(host=host, port=port, output_dir=output_dir)


@v2_app.command("run")
def cmd_v2_run(
    study_id: str = typer.Option(..., "--study-id", envvar="STUDY_ID"),
    output_dir: Path = typer.Option(Path("output"), "--output-dir", "-o"),
    from_step: int = typer.Option(1, "--from-step", min=1, max=14),
    to_step: int = typer.Option(14, "--to-step", min=1, max=14),
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


@v2_app.command("validate")
def cmd_v2_validate(
    study_id: str = typer.Option(..., "--study-id", envvar="STUDY_ID"),
    output_dir: Path = typer.Option(Path("output"), "--output-dir", "-o"),
) -> None:
    """Validate final PD specification artifacts for a study."""
    _load_env()
    from pdcheck_factory.json_util import read_json
    from pdcheck_factory.check_validate import validate_check_artifacts

    final_path = paths.local_final_deviations_json(study_id, output_dir)
    if not final_path.is_file():
        raise typer.BadParameter(f"Missing final deviations JSON: {final_path}")
    final_obj = read_json(final_path)
    paragraph_index: dict = {}
    index_path = paths.local_protocol_paragraph_index_json(study_id, output_dir)
    if index_path.is_file():
        paragraph_index = read_json(index_path)
    deviations_obj = {"deviations": []}
    deviations_path = paths.local_deviations_validated_json(study_id, output_dir)
    if deviations_path.is_file():
        deviations_obj = read_json(deviations_path)
    rules_obj = {"rules": []}
    rules_path = paths.local_rules_parsed_json(study_id, output_dir)
    if rules_path.is_file():
        rules_obj = read_json(rules_path)
    pseudo_obj = {"items": []}
    pseudo_path = paths.local_pseudo_logic_validated_json(study_id, output_dir)
    if pseudo_path.is_file():
        pseudo_obj = read_json(pseudo_path)
    dictionary_obj = {}
    dictionary_path = paths.local_acrf_field_dictionary_json(study_id, output_dir)
    if dictionary_path.is_file():
        dictionary_obj = read_json(dictionary_path)
    report = validate_check_artifacts(
        deviations_obj=deviations_obj,
        rules_obj=rules_obj,
        pseudo_obj=pseudo_obj,
        dictionary_obj=dictionary_obj,
        final_obj=final_obj,
        paragraph_index=paragraph_index,
    )
    typer.echo(json.dumps(report.to_dict(), indent=2))
    if not report.ok:
        raise typer.Exit(code=1)


@v2_app.command("ready-for-review")
def cmd_v2_ready_for_review(
    study_id: str = typer.Option(..., "--study-id", envvar="STUDY_ID"),
    output_dir: Path = typer.Option(Path("output"), "--output-dir", "-o"),
) -> None:
    """Run ready-for-review checklist on final PD specification output."""
    cmd_v2_validate(study_id=study_id, output_dir=output_dir)


def main() -> None:
    app()



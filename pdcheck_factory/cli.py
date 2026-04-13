"""Typer CLI for the Azure MVP pipeline."""

from __future__ import annotations

import os
import shutil
from pathlib import Path
from typing import List, Literal, Optional

import typer
from dotenv import load_dotenv

from pdcheck_factory import blob_io, di_layout, paths
from pdcheck_factory import llm as llm_mod
from pdcheck_factory import step2_merge
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

_STALE_LEGACY = (
    "This command targets the removed v1 pipeline (candidates.json + logic_drafts.json). "
    "Step 1 uses `pdcheck protocol segment` and `pdcheck protocol sections extract`. "
    "A future Phase 2 adapter will bridge Step 1 JSON to pd_draft_specs."
)


def _load_env() -> None:
    load_dotenv()


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
    debug_blob: bool = False,
) -> None:
    """Run Document Intelligence Layout on protocol (+ optional aCRF) PDFs in Blob."""
    _load_env()
    if upload_only and not upload:
        raise typer.BadParameter("--upload-only cannot be used with --no-upload.")

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


def run_protocol_segment(
    *,
    study_id: str,
    output_dir: Path,
    upload: bool,
    strip_page_markers: bool = True,
    rollup_max_section_level: Optional[int] = None,
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

    acrf: Optional[str] = None
    if include_acrf:
        acrf = _optional_acrf_markdown(study_id, output_dir)
        if acrf:
            acrf_chars_total = len(acrf.strip())
            acrf_chars_used = min(acrf_chars_total, llm_mod.STEP1_ACRF_MAX_CHARS)
            pct_used = (
                (acrf_chars_used / acrf_chars_total) * 100.0
                if acrf_chars_total
                else 0.0
            )
            print(
                "Including aCRF context in prompts "
                f"(truncated by LLM layer): {acrf_chars_used}/{acrf_chars_total} "
                f"chars ({pct_used:.1f}%)."
            )
        else:
            print("No aCRF source.md found; protocol-only prompts.")

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
    rollup_max_section_level: Optional[int] = None,
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
    )


def run_clear_stage(
    *,
    study_id: str,
    stage: Literal["extraction", "step1"],
    output_dir: Path,
    clear_blob: bool,
) -> None:
    """Delete local artifacts (and optionally blob artifacts) for one stage."""
    if stage == "extraction":
        targets = [
            paths.local_extraction_layout(study_id, "protocol", output_dir),
            paths.local_extraction_layout(study_id, "acrf", output_dir),
        ]
        blob_prefixes = [
            paths.extraction_layout_prefix(study_id, "protocol"),
            paths.extraction_layout_prefix(study_id, "acrf"),
        ]
    elif stage == "step1":
        targets = [paths.local_protocol_sections_step1_dir(study_id, output_dir)]
        blob_prefixes = [f"{paths.protocol_sections_blob_prefix(study_id)}/step1/"]
    else:
        raise typer.BadParameter(f"Unsupported stage: {stage}")

    removed = 0
    for target in targets:
        if target.exists():
            shutil.rmtree(target)
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
) -> Path:
    """Merge and semantic-dedup all Step 1 section outputs into one Step 2 artifact."""
    _load_env()
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

    merged = step2_merge.merge_step1_outputs(
        study_id=study_id,
        step1_objects=step1_objects,
    )
    step2_schema = load_schema("protocol_sections_step2_merged.schema.json")
    out_errs = validate(merged, step2_schema)
    if out_errs:
        raise typer.BadParameter(
            "Step 2 output failed schema validation: " + "; ".join(out_errs[:10])
        )

    out_path = paths.local_protocol_sections_step2_merged(study_id, output_dir)
    write_json(out_path, merged)
    print(f"Wrote {out_path}")
    _upload_if_enabled(
        out_path,
        paths.protocol_sections_step2_merged_blob(study_id),
        upload=upload,
        content_type="application/json",
    )
    return out_path


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
    rollup_to_level: Optional[int] = typer.Option(
        None,
        "--rollup-to-level",
        min=1,
        max=6,
        help="Max ATX depth for manifest sections (1=# only … 6=######). Deeper headings roll into parent body.",
    ),
) -> None:
    """Segment protocol and run Step 1 extraction on every section (shortcut)."""
    run_rules(
        study_id=study_id,
        output_dir=output_dir,
        upload=upload,
        strip_page_markers=not keep_di_page_markers,
        rollup_max_section_level=rollup_to_level,
    )


@app.command("clear-stage")
def cmd_clear_stage(
    study_id: str = typer.Option(..., "--study-id", envvar="STUDY_ID"),
    stage: Literal["extraction", "step1"] = typer.Option(
        ...,
        "--stage",
        help="Pipeline stage outputs to clear: extraction or step1.",
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
) -> None:
    """Merge Step 1 section outputs and deduplicate semantic duplicates."""
    run_step2_merge(study_id=study_id, output_dir=output_dir, upload=upload)


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
    rollup_to_level: Optional[int] = typer.Option(
        None,
        "--rollup-to-level",
        min=1,
        max=6,
        help="Max ATX depth for manifest sections (1=# only … 6=######). Deeper headings roll into parent body.",
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
    )


app.add_typer(protocol_app, name="protocol")


def run_draft_pd(*, study_id: str, output_dir: Path, upload: bool) -> None:
    raise typer.BadParameter(
        "draft-pd was removed. Use: "
        f"`pdcheck protocol segment --study-id ...` then "
        f"`pdcheck protocol sections extract --study-id ... --all` "
        "(or `pdcheck rules` for both)."
    )


@app.command("draft-pd")
def cmd_draft_pd(
    study_id: str = typer.Option(..., "--study-id", envvar="STUDY_ID"),
    output_dir: Path = typer.Option(Path("output"), "--output-dir", "-o"),
    upload: bool = typer.Option(True, "--upload/--no-upload"),
) -> None:
    """Removed; use `pdcheck protocol sections extract` after `protocol segment`."""
    run_draft_pd(study_id=study_id, output_dir=output_dir, upload=upload)


def run_merge(*, study_id: str, output_dir: Path, upload: bool) -> None:
    raise typer.BadParameter(_STALE_LEGACY)


@app.command()
def merge(
    study_id: str = typer.Option(..., "--study-id", envvar="STUDY_ID"),
    output_dir: Path = typer.Option(Path("output"), "--output-dir", "-o"),
    upload: bool = typer.Option(True, "--upload/--no-upload"),
) -> None:
    """Removed in Step 1; see `pdcheck merge --help` error text when invoked."""
    run_merge(study_id=study_id, output_dir=output_dir, upload=upload)


@app.command("export-review")
def cmd_export_review(
    study_id: str = typer.Option(..., "--study-id", envvar="STUDY_ID"),
    output_dir: Path = typer.Option(Path("output"), "--output-dir", "-o"),
    upload: bool = typer.Option(True, "--upload/--no-upload"),
) -> None:
    """Export pd_draft_specs to an XLSX workbook for DM review."""
    raise typer.BadParameter(_STALE_LEGACY)


@app.command("apply-review")
def cmd_apply_review(
    study_id: str = typer.Option(..., "--study-id", envvar="STUDY_ID"),
    workbook: Path = typer.Option(..., "--workbook", "-w", help="Edited XLSX path"),
    output_dir: Path = typer.Option(Path("output"), "--output-dir", "-o"),
    upload: bool = typer.Option(True, "--upload/--no-upload"),
) -> None:
    """Apply DM edits from workbook back into pd_draft_specs.json."""
    raise typer.BadParameter(_STALE_LEGACY)


@app.command("emit-pseudo")
def cmd_emit_pseudo(
    study_id: str = typer.Option(..., "--study-id", envvar="STUDY_ID"),
    output_dir: Path = typer.Option(Path("output"), "--output-dir", "-o"),
    upload: bool = typer.Option(True, "--upload/--no-upload"),
) -> None:
    """Build pseudo_logic_bundle.json (+ .md) from current pd_draft_specs."""
    raise typer.BadParameter(_STALE_LEGACY)


@app.command("run-all")
def cmd_run_all(
    study_id: str = typer.Option(..., "--study-id", envvar="STUDY_ID"),
    output_dir: Path = typer.Option(Path("output"), "--output-dir", "-o"),
    skip_acrf: bool = typer.Option(False, "--skip-acrf"),
    upload: bool = typer.Option(True, "--upload/--no-upload"),
) -> None:
    """extract → protocol segment + Step 1 extract for all sections (no merge / XLSX)."""
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
        debug_blob=False,
    )
    run_rules(study_id=study_id, output_dir=output_dir, upload=upload)
    print("run-all complete through Step 1 extraction.")


def main() -> None:
    app()


if __name__ == "__main__":
    main()

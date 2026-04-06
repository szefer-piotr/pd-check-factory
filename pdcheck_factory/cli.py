"""Typer CLI for the Azure MVP pipeline."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

import typer
from dotenv import load_dotenv

from pdcheck_factory import blob_io, di_layout, paths
from pdcheck_factory import llm as llm_mod
from pdcheck_factory.json_util import read_json, write_json
from pdcheck_factory.merge import merge_and_validate_files
from pdcheck_factory.pseudo_bundle import emit_pseudo_bundle
from pdcheck_factory.xlsx_review import apply_dm_workbook, export_dm_workbook

app = typer.Typer(no_args_is_help=True, help="PD Check Factory — Azure MVP monolith.")


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


def run_rules(
    *, study_id: str, output_dir: Path, upload: bool
) -> None:
    """LLM pass 1: protocol markdown → protocol_rules_kb.json."""
    _load_env()
    proto_md = (
        paths.local_extraction_layout(study_id, "protocol", output_dir)
        / "rendered"
        / "source.md"
    )
    if not proto_md.exists():
        raise typer.BadParameter(
            f"Missing {proto_md}. Run `extract --study-id {study_id}` first."
        )
    protocol_markdown = proto_md.read_text(encoding="utf-8")
    kb = llm_mod.extract_protocol_rules_kb(
        study_id=study_id, protocol_markdown=protocol_markdown
    )
    out = paths.local_pipeline_rules_kb(study_id, output_dir)
    write_json(out, kb)
    print(f"Wrote {out}")
    _upload_if_enabled(
        out,
        paths.pipeline_rules_kb_blob(study_id),
        upload=upload,
        content_type="application/json",
    )


@app.command("rules")
def cmd_rules(
    study_id: str = typer.Option(..., "--study-id", envvar="STUDY_ID"),
    output_dir: Path = typer.Option(Path("output"), "--output-dir", "-o"),
    upload: bool = typer.Option(True, "--upload/--no-upload"),
) -> None:
    """LLM pass 1: protocol markdown → protocol_rules_kb.json."""
    run_rules(study_id=study_id, output_dir=output_dir, upload=upload)


def run_draft_pd(*, study_id: str, output_dir: Path, upload: bool) -> None:
    """LLM pass 2: rules KB + aCRF → candidates.json and logic_drafts.json."""
    _load_env()
    kb_path = paths.local_pipeline_rules_kb(study_id, output_dir)
    if not kb_path.exists():
        raise typer.BadParameter(f"Missing {kb_path}. Run `rules` first.")
    rules_kb = read_json(kb_path)

    acrf_md = (
        paths.local_extraction_layout(study_id, "acrf", output_dir)
        / "rendered"
        / "source.md"
    )
    if not acrf_md.exists():
        raise typer.BadParameter(
            f"Missing {acrf_md}. Run `extract` without --skip-acrf first."
        )
    acrf_markdown = acrf_md.read_text(encoding="utf-8")

    print("Running LLM: PD candidates...")
    candidates = llm_mod.draft_pd_candidates(
        study_id=study_id, rules_kb=rules_kb, acrf_markdown=acrf_markdown
    )
    pd_dir = paths.local_pipeline_pd_dir(study_id, output_dir)
    cand_path = pd_dir / "candidates.json"
    logic_path = pd_dir / "logic_drafts.json"
    write_json(cand_path, candidates)
    _upload_if_enabled(
        cand_path,
        paths.candidates_blob(study_id),
        upload=upload,
        content_type="application/json",
    )

    print("Running LLM: PD logic drafts...")
    logic = llm_mod.draft_pd_logic(
        study_id=study_id,
        rules_kb=rules_kb,
        acrf_markdown=acrf_markdown,
        candidates=candidates,
    )
    write_json(logic_path, logic)
    _upload_if_enabled(
        logic_path,
        paths.logic_drafts_blob(study_id),
        upload=upload,
        content_type="application/json",
    )
    print(f"Wrote {cand_path} and {logic_path}")


@app.command("draft-pd")
def cmd_draft_pd(
    study_id: str = typer.Option(..., "--study-id", envvar="STUDY_ID"),
    output_dir: Path = typer.Option(Path("output"), "--output-dir", "-o"),
    upload: bool = typer.Option(True, "--upload/--no-upload"),
) -> None:
    """LLM pass 2: rules KB + aCRF → candidates.json and logic_drafts.json."""
    run_draft_pd(study_id=study_id, output_dir=output_dir, upload=upload)


def run_merge(*, study_id: str, output_dir: Path, upload: bool) -> None:
    """Merge candidates + logic → pd_draft_specs.json (validated)."""
    _load_env()
    pd_dir = paths.local_pipeline_pd_dir(study_id, output_dir)
    out_path = pd_dir / "pd_draft_specs.json"
    merge_and_validate_files(
        study_id=study_id,
        candidates_path=pd_dir / "candidates.json",
        logic_path=pd_dir / "logic_drafts.json",
        output_path=out_path,
    )
    print(f"Wrote {out_path}")
    _upload_if_enabled(
        out_path,
        paths.pd_draft_specs_blob(study_id),
        upload=upload,
        content_type="application/json",
    )


@app.command()
def merge(
    study_id: str = typer.Option(..., "--study-id", envvar="STUDY_ID"),
    output_dir: Path = typer.Option(Path("output"), "--output-dir", "-o"),
    upload: bool = typer.Option(True, "--upload/--no-upload"),
) -> None:
    """Merge candidates + logic → pd_draft_specs.json (validated)."""
    run_merge(study_id=study_id, output_dir=output_dir, upload=upload)


@app.command("export-review")
def cmd_export_review(
    study_id: str = typer.Option(..., "--study-id", envvar="STUDY_ID"),
    output_dir: Path = typer.Option(Path("output"), "--output-dir", "-o"),
    upload: bool = typer.Option(True, "--upload/--no-upload"),
) -> None:
    """Export pd_draft_specs to an XLSX workbook for DM review."""
    _load_env()
    specs = paths.local_pipeline_pd_dir(study_id, output_dir) / "pd_draft_specs.json"
    if not specs.exists():
        raise typer.BadParameter(f"Missing {specs}. Run `merge` first.")
    xlsx_path = paths.local_dm_review_workbook(study_id, output_dir)
    export_dm_workbook(pd_specs_path=specs, output_path=xlsx_path)
    print(f"Wrote {xlsx_path}")
    _upload_if_enabled(
        xlsx_path,
        paths.dm_review_workbook_blob(study_id),
        upload=upload,
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


@app.command("apply-review")
def cmd_apply_review(
    study_id: str = typer.Option(..., "--study-id", envvar="STUDY_ID"),
    workbook: Path = typer.Option(..., "--workbook", "-w", help="Edited XLSX path"),
    output_dir: Path = typer.Option(Path("output"), "--output-dir", "-o"),
    upload: bool = typer.Option(True, "--upload/--no-upload"),
) -> None:
    """Apply DM edits from workbook back into pd_draft_specs.json."""
    _load_env()
    specs_in = paths.local_pipeline_pd_dir(study_id, output_dir) / "pd_draft_specs.json"
    if not specs_in.exists():
        raise typer.BadParameter(f"Missing {specs_in}. Run `merge` first.")
    specs_out = specs_in
    apply_dm_workbook(
        pd_specs_path=specs_in, workbook_path=workbook, output_specs_path=specs_out
    )
    print(f"Updated {specs_out}")
    _upload_if_enabled(
        specs_out,
        paths.pd_draft_specs_blob(study_id),
        upload=upload,
        content_type="application/json",
    )


@app.command("emit-pseudo")
def cmd_emit_pseudo(
    study_id: str = typer.Option(..., "--study-id", envvar="STUDY_ID"),
    output_dir: Path = typer.Option(Path("output"), "--output-dir", "-o"),
    upload: bool = typer.Option(True, "--upload/--no-upload"),
) -> None:
    """Build pseudo_logic_bundle.json (+ .md) from current pd_draft_specs."""
    _load_env()
    specs = paths.local_pipeline_pd_dir(study_id, output_dir) / "pd_draft_specs.json"
    if not specs.exists():
        raise typer.BadParameter(f"Missing {specs}. Run `merge` (and optionally `apply-review`).")
    out = paths.local_pseudo_bundle(study_id, output_dir)
    emit_pseudo_bundle(pd_specs_path=specs, output_path=out, study_id=study_id)
    print(f"Wrote {out} and {out.with_suffix('.md')}")
    _upload_if_enabled(
        out,
        paths.pseudo_bundle_blob(study_id),
        upload=upload,
        content_type="application/json",
    )


@app.command("run-all")
def cmd_run_all(
    study_id: str = typer.Option(..., "--study-id", envvar="STUDY_ID"),
    output_dir: Path = typer.Option(Path("output"), "--output-dir", "-o"),
    skip_acrf: bool = typer.Option(False, "--skip-acrf"),
    upload: bool = typer.Option(True, "--upload/--no-upload"),
) -> None:
    """extract → rules → draft-pd → merge (no XLSX / pseudo)."""
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
    run_draft_pd(study_id=study_id, output_dir=output_dir, upload=upload)
    run_merge(study_id=study_id, output_dir=output_dir, upload=upload)
    print("run-all complete through merge.")


def main() -> None:
    app()


if __name__ == "__main__":
    main()

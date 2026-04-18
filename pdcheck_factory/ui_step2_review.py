"""Local FastAPI UI for Step 2 DM review (optional dependency: pip install -e '.[ui]')."""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field
from starlette import status

from pdcheck_factory import llm as llm_mod
from pdcheck_factory import paths
from pdcheck_factory.json_util import read_json, write_json
from pdcheck_factory.step2_review import (
    apply_review_and_finalize,
    build_row_key,
    write_finalized_step2_outputs,
)
from pdcheck_factory.step2_ui_helpers import (
    BaselineName,
    acrf_preview,
    build_review_rows_from_ui_updates,
    flatten_step2_rows,
    local_step2_working_merged,
    protocol_section_preview,
    resolve_step2_baseline_path,
)

_templates_dir = Path(__file__).resolve().parent / "ui_templates"
templates = Jinja2Templates(directory=str(_templates_dir))


def _find_deviation(step2_obj: Dict[str, Any], row_key: str) -> Optional[Dict[str, Any]]:
    for rule in step2_obj.get("rules", []) or []:
        rid = str(rule.get("rule_id", ""))
        for dev in rule.get("candidate_deviations", []) or []:
            if build_row_key(rid, str(dev.get("deviation_id", ""))) == row_key:
                return dev
    return None


class ApplyPayload(BaseModel):
    baseline: BaselineName = "merged"
    updates: Dict[str, Dict[str, Any]] = Field(default_factory=dict)
    strict: bool = False


def build_app(
    *,
    study_id: str,
    output_dir: Path,
    context_mode: Literal["full_protocol", "sections_only"] = "full_protocol",
    use_acrf_summary: bool = True,
) -> FastAPI:
    app = FastAPI(title="PD Check — Step 2 review", version="0.1.0")

    @app.get("/", response_class=HTMLResponse)
    def index(request: Request, baseline: BaselineName = "merged") -> Any:
        path = resolve_step2_baseline_path(study_id, output_dir, baseline)
        if not path.is_file():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Missing Step 2 file for baseline={baseline!r}: {path}",
            )
        step2_obj = read_json(path)
        rows = flatten_step2_rows(step2_obj)
        merged_path = paths.local_protocol_sections_step2_merged(study_id, output_dir)
        validated_path = paths.local_protocol_sections_step2_validated(study_id, output_dir)
        working_path = local_step2_working_merged(study_id, output_dir)
        return templates.TemplateResponse(
            request,
            "step2_index.html",
            {
                "study_id": study_id,
                "output_dir": str(output_dir),
                "baseline": baseline,
                "rows": rows,
                "step2_path": str(path),
                "has_merged": merged_path.is_file(),
                "has_validated": validated_path.is_file(),
                "has_working": working_path.is_file(),
                "context_mode": context_mode,
                "use_acrf_summary": use_acrf_summary,
            },
        )

    @app.get("/api/context/{row_key:path}")
    def api_context(row_key: str, baseline: BaselineName = "merged") -> JSONResponse:
        order: List[BaselineName] = []
        for b in (baseline, "merged", "working", "validated"):
            if b not in order:
                order.append(b)
        target_dev: Optional[Dict[str, Any]] = None
        for b in order:
            p = resolve_step2_baseline_path(study_id, output_dir, b)
            if not p.is_file():
                continue
            step2_obj = read_json(p)
            target_dev = _find_deviation(step2_obj, row_key)
            if target_dev is not None:
                break
        if target_dev is None:
            raise HTTPException(status_code=404, detail=f"Unknown row_key: {row_key}")
        sids = list(target_dev.get("source_section_ids", []) or [])
        protocol_txt = protocol_section_preview(
            study_id=study_id, output_dir=output_dir, section_ids=sids
        )
        merged_json, raw_acrf = acrf_preview(study_id=study_id, output_dir=output_dir)
        return JSONResponse(
            {
                "row_key": row_key,
                "protocol_markdown": protocol_txt,
                "acrf_summary_json": merged_json,
                "acrf_raw_excerpt": raw_acrf,
            }
        )

    @app.post("/api/apply")
    def api_apply(body: ApplyPayload) -> JSONResponse:
        load_dotenv()
        input_path = resolve_step2_baseline_path(study_id, output_dir, body.baseline)
        if not input_path.is_file():
            raise HTTPException(status_code=404, detail=f"Missing baseline input: {input_path}")
        step2_obj = read_json(input_path)
        review_rows = build_review_rows_from_ui_updates(body.updates)
        if review_rows["errors"]:
            raise HTTPException(
                status_code=400,
                detail={"errors": review_rows["errors"]},
            )

        from pdcheck_factory.cli import _load_acrf_contexts, _read_protocol_source_md

        full_protocol = _read_protocol_source_md(study_id, output_dir).read_text(encoding="utf-8")
        _, acrf_summary_context = _load_acrf_contexts(
            study_id=study_id,
            output_dir=output_dir,
            include_acrf=True,
            use_acrf_summary=use_acrf_summary,
            caller="ui-step2-revalidate",
        )

        def _revalidate(rule: dict, deviation: dict, dm_comments: str) -> List[dict]:
            if context_mode == "full_protocol":
                protocol_context = full_protocol
            else:
                protocol_context = protocol_section_preview(
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

        try:
            final_obj, audit_obj, _final_rows = apply_review_and_finalize(
                step2_obj=step2_obj,
                review_rows=review_rows,
                revalidate_deviation=_revalidate,
                strict=body.strict,
            )
        except ValueError as ex:
            raise HTTPException(status_code=400, detail=str(ex)) from ex

        final_json_path = paths.local_protocol_sections_step2_validated(study_id, output_dir)
        audit_json_path = paths.local_protocol_sections_step2_validation_audit(
            study_id, output_dir
        )
        write_finalized_step2_outputs(
            final_obj=final_obj,
            audit_obj=audit_obj,
            final_json_path=final_json_path,
            audit_json_path=audit_json_path,
        )
        return JSONResponse(
            {
                "ok": True,
                "wrote_validated": str(final_json_path),
                "wrote_audit": str(audit_json_path),
                "audit": audit_obj,
            }
        )

    @app.post("/api/promote-validated")
    def api_promote() -> JSONResponse:
        src = paths.local_protocol_sections_step2_validated(study_id, output_dir)
        if not src.is_file():
            raise HTTPException(status_code=404, detail=f"Missing {src}")
        dst = local_step2_working_merged(study_id, output_dir)
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        return JSONResponse({"ok": True, "wrote": str(dst)})

    return app

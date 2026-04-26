"""Local FastAPI UI for Pipeline V2 deviation/pseudo review loops."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field

from pdcheck_factory import paths, pipeline_v2
from pdcheck_factory.json_util import read_json, write_json

_templates_dir = Path(__file__).resolve().parent / "ui_templates"
templates = Jinja2Templates(directory=str(_templates_dir))

Status = Literal["pending", "accepted", "to_review", "rejected"]
ReviewType = Literal["deviations", "pseudo"]


class RowUpdate(BaseModel):
    status: Status
    dm_comment: str = ""


class ApplyPayload(BaseModel):
    review_type: ReviewType
    updates: Dict[str, RowUpdate] = Field(default_factory=dict)
    run_revision_cycle: bool = False


def _state_path(study_id: str, output_dir: Path, review_type: ReviewType) -> Path:
    if review_type == "deviations":
        return paths.local_deviations_review_state(study_id, output_dir)
    return paths.local_pseudo_logic_review_state(study_id, output_dir)


def _validated_path(study_id: str, output_dir: Path, review_type: ReviewType) -> Path:
    if review_type == "deviations":
        return paths.local_deviations_validated_json(study_id, output_dir)
    return paths.local_pseudo_logic_validated_json(study_id, output_dir)


def _audit_path(study_id: str, output_dir: Path, review_type: ReviewType) -> Path:
    if review_type == "deviations":
        return paths.local_deviations_review_audit_json(study_id, output_dir)
    return paths.local_pseudo_logic_review_audit_json(study_id, output_dir)


def _row_key_for(review_type: ReviewType, row: Dict[str, Any]) -> str:
    if review_type == "deviations":
        return str(row.get("deviation_id", ""))
    return str(row.get("deviation_id", ""))


def _list_rows(state_obj: Dict[str, Any], review_type: ReviewType) -> List[Dict[str, Any]]:
    if review_type == "deviations":
        return list(state_obj.get("deviations", []))
    return list(state_obj.get("items", []))


def build_app(*, study_id: str, output_dir: Path) -> FastAPI:
    app = FastAPI(title="PD Check Pipeline V2 Review", version="0.1.0")

    @app.get("/", response_class=HTMLResponse)
    def index(request: Request, review_type: ReviewType = "deviations") -> Any:
        state_path = _state_path(study_id, output_dir, review_type)
        if not state_path.is_file():
            raise HTTPException(status_code=404, detail=f"Missing review state: {state_path}")
        state_obj = read_json(state_path)
        rows = _list_rows(state_obj, review_type)
        return templates.TemplateResponse(
            request,
            "v2_review_index.html",
            {
                "study_id": study_id,
                "review_type": review_type,
                "rows": rows,
            },
        )

    @app.post("/api/apply")
    def apply_updates(body: ApplyPayload) -> JSONResponse:
        state_path = _state_path(study_id, output_dir, body.review_type)
        if not state_path.is_file():
            raise HTTPException(status_code=404, detail=f"Missing review state: {state_path}")
        state_obj = read_json(state_path)
        rows = _list_rows(state_obj, body.review_type)
        updated = 0
        revised = 0
        protocol_index = read_json(paths.local_protocol_paragraph_index_json(study_id, output_dir))
        protocol_text = "\n\n".join(
            [f"{p['paragraph_id']}: {p['text']}" for p in protocol_index.get("paragraphs", [])]
        )
        acrf_summary = read_json(paths.local_acrf_summary_text_merged(study_id, output_dir))
        acrf_summary_text = str(acrf_summary)
        for row in rows:
            key = _row_key_for(body.review_type, row)
            update = body.updates.get(key)
            if not update:
                continue
            row["status"] = update.status
            row["dm_comment"] = update.dm_comment
            updated += 1
            if body.run_revision_cycle and update.status == "to_review" and update.dm_comment.strip():
                text_field = "text" if body.review_type == "deviations" else "pseudo_logic"
                revised_text, revised_refs = pipeline_v2.revise_text_with_comment(
                    study_id=study_id,
                    item_type=body.review_type,
                    original_text=row.get(text_field, ""),
                    paragraph_refs=list(row.get("paragraph_refs", [])),
                    dm_comment=update.dm_comment,
                    protocol_paragraphs=protocol_text,
                    acrf_summary=acrf_summary_text,
                )
                row[text_field] = revised_text
                if body.review_type == "deviations" and revised_refs:
                    row["paragraph_refs"] = revised_refs
                revised += 1

        write_json(state_path, state_obj)
        write_json(_validated_path(study_id, output_dir, body.review_type), state_obj)
        write_json(
            _audit_path(study_id, output_dir, body.review_type),
            {
                "study_id": study_id,
                "review_type": body.review_type,
                "updated_rows": updated,
                "revised_rows": revised,
                "run_revision_cycle": body.run_revision_cycle,
            },
        )
        return JSONResponse({"ok": True, "updated": updated, "revised": revised})

    return app

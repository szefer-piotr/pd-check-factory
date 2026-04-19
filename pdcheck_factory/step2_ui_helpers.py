"""Pure helpers for Step 2 DM review UI (no FastAPI dependency)."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Literal, Optional, Set, Tuple

from pdcheck_factory import paths
from pdcheck_factory.protocol_markdown import load_manifest
from pdcheck_factory.step2_review import VALIDATION_STATUSES, build_row_key

BaselineName = Literal["merged", "validated", "working"]

WORKING_MERGED_FILENAME = "step2_merged.working.json"


def local_step2_working_merged(study_id: str, output_dir: Path) -> Path:
    return paths.local_pipeline_step2_dir(study_id, output_dir) / WORKING_MERGED_FILENAME


def resolve_step2_baseline_path(
    study_id: str, output_dir: Path, baseline: BaselineName
) -> Path:
    if baseline == "merged":
        return paths.local_protocol_sections_step2_merged(study_id, output_dir)
    if baseline == "validated":
        return paths.local_protocol_sections_step2_validated(study_id, output_dir)
    return local_step2_working_merged(study_id, output_dir)


def _sentence_text_index(manifest: Dict[str, Any]) -> Dict[str, str]:
    """Map sentence id (e.g. sec:abc#s1) to sentence text from sections_manifest."""
    out: Dict[str, str] = {}
    for sec in manifest.get("sections", []) or []:
        for sent in sec.get("sentences", []) or []:
            sid = sent.get("id")
            if not isinstance(sid, str) or not sid.strip():
                continue
            out[sid.strip()] = (sent.get("text") or "").strip()
    return out


def protocol_referenced_sentences_preview(
    *,
    study_id: str,
    output_dir: Path,
    rule_sentence_refs: List[str],
    deviation_sentence_refs: List[str],
) -> str:
    """
    Markdown-ish text for only the cited protocol sentences (rule refs, then deviation refs,
    de-duplicated in order). Requires sections_manifest.json from protocol segmentation.
    """
    man_path = paths.local_protocol_sections_manifest(study_id, output_dir)
    if not man_path.is_file():
        return (
            "(sections manifest not found; run `pdcheck protocol segment` for this study.)\n"
        )
    manifest = load_manifest(man_path)
    index = _sentence_text_index(manifest)
    ordered: List[str] = []
    seen: Set[str] = set()
    for ref in list(rule_sentence_refs or []) + list(deviation_sentence_refs or []):
        r = (ref or "").strip()
        if not r or r in seen:
            continue
        seen.add(r)
        ordered.append(r)
    if not ordered:
        return "(no sentence references on this rule or deviation.)\n"
    blocks: List[str] = []
    for ref in ordered:
        txt = index.get(ref)
        if txt:
            blocks.append(f"`{ref}`\n\n{txt}")
        else:
            blocks.append(f"`{ref}`\n\n_(sentence text not found in manifest)_")
    return "\n\n---\n\n".join(blocks)


def protocol_section_preview(
    *, study_id: str, output_dir: Path, section_ids: List[str]
) -> str:
    """Join raw protocol section fragments; fallback to full protocol source.md."""
    raw_dir = paths.local_protocol_sections_raw_dir(study_id, output_dir)
    chunks: List[str] = []
    for sid in sorted(set(section_ids)):
        safe = sid.replace(":", "_")
        path = raw_dir / f"{safe}.md"
        if path.is_file():
            chunks.append(path.read_text(encoding="utf-8"))
    if chunks:
        return "\n\n---\n\n".join(chunks)
    proto_md = (
        paths.local_extraction_layout(study_id, "protocol", output_dir)
        / "rendered"
        / "source.md"
    )
    if proto_md.is_file():
        return proto_md.read_text(encoding="utf-8")
    return ""


def acrf_preview(
    *,
    study_id: str,
    output_dir: Path,
    raw_max_chars: int = 12000,
) -> Tuple[Optional[str], Optional[str]]:
    """Return (merged_summary_compact_json_or_none, raw_acrf_excerpt_or_none)."""
    merged_path = paths.local_acrf_summary_merged(study_id, output_dir)
    merged_txt: Optional[str] = None
    if merged_path.is_file():
        merged_txt = merged_path.read_text(encoding="utf-8")
    raw_md = (
        paths.local_extraction_layout(study_id, "acrf", output_dir)
        / "rendered"
        / "source.md"
    )
    raw_excerpt: Optional[str] = None
    if raw_md.is_file():
        body = raw_md.read_text(encoding="utf-8").strip()
        if len(body) > raw_max_chars:
            body = body[:raw_max_chars] + "\n\n[TRUNCATED]\n"
        raw_excerpt = body
    return merged_txt, raw_excerpt


def build_review_rows_from_ui_updates(
    updates: Dict[str, Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Build the dict shape expected by apply_review_and_finalize (like read_step2_review_workbook).
    updates: row_key -> { validation_status, dm_comments, programmable? }
    """
    errors: List[str] = []
    out: Dict[str, Dict[str, str]] = {}
    for row_key, payload in updates.items():
        if not isinstance(payload, dict):
            errors.append(f"{row_key}: update must be an object.")
            continue
        status_raw = str(payload.get("validation_status", "")).strip().lower()
        if status_raw not in VALIDATION_STATUSES:
            errors.append(
                f"{row_key}: invalid validation_status={payload.get('validation_status')!r}"
            )
            continue
        rule_id = str(payload.get("rule_id", "")).strip()
        deviation_id = str(payload.get("deviation_id", "")).strip()
        rk = (row_key or "").strip()
        if not rk and rule_id and deviation_id:
            rk = build_row_key(rule_id, deviation_id)
        if not rk:
            errors.append(f"{row_key!r}: missing row_key / rule_id / deviation_id.")
            continue
        prog = payload.get("programmable", "")
        prog_s = str(prog).strip().lower() if prog is not None else ""
        if prog_s and prog_s not in {"true", "false"}:
            errors.append(f"{row_key}: programmable must be true, false, or empty.")
            continue
        out[rk] = {
            "row_key": rk,
            "rule_id": rule_id,
            "deviation_id": deviation_id,
            "validation_status": status_raw,
            "dm_comments": str(payload.get("dm_comments", "")).strip(),
            "programmable": prog_s,
        }
    return {"updates": out, "warnings": [], "errors": errors}


def flatten_step2_rows(step2_obj: Dict[str, Any]) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for rule in step2_obj.get("rules", []) or []:
        rid = rule.get("rule_id", "")
        for dev in rule.get("candidate_deviations", []) or []:
            did = dev.get("deviation_id", "")
            rows.append(
                {
                    "row_key": build_row_key(str(rid), str(did)),
                    "rule": rule,
                    "deviation": dev,
                }
            )
    return rows

"""Pipeline V2 orchestration with paragraph anchors and UI review artifacts."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from openpyxl import Workbook

from pdcheck_factory import llm, paths, text_parse
from pdcheck_factory.json_util import load_schema, read_json, validate, write_json
from pdcheck_factory.prompt_loader import load_prompt


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _protocol_source(study_id: str, output_dir: Path) -> Path:
    p = (
        paths.local_study_root(study_id, output_dir)
        / "extractions"
        / "protocol"
        / "opendataloader"
        / "rendered"
        / "source.md"
    )
    if not p.is_file():
        raise ValueError(f"Missing protocol source markdown: {p}")
    return p


def _acrf_sections_dir(study_id: str, output_dir: Path) -> Path:
    p = (
        paths.local_study_root(study_id, output_dir)
        / "extractions"
        / "acrf"
        / "layout"
        / "rendered"
        / "sections_toc"
    )
    if not p.is_dir():
        raise ValueError(f"Missing aCRF sections_toc directory: {p}")
    return p


def _split_paragraphs(markdown: str) -> List[str]:
    paragraphs: List[str] = []
    cur: List[str] = []
    for line in markdown.splitlines():
        if line.strip() == "":
            if cur:
                paragraphs.append("\n".join(cur).strip())
                cur = []
            continue
        cur.append(line.rstrip())
    if cur:
        paragraphs.append("\n".join(cur).strip())
    return [p for p in paragraphs if p]


def step2_protocol_paragraph_index(study_id: str, output_dir: Path) -> Dict[str, Any]:
    text = _protocol_source(study_id, output_dir).read_text(encoding="utf-8")
    raw_paragraphs = _split_paragraphs(text)
    paragraphs: List[Dict[str, Any]] = []
    numbered_lines: List[str] = []
    cursor = 0
    for i, paragraph in enumerate(raw_paragraphs, start=1):
        pid = f"p{i}"
        start = text.find(paragraph, cursor)
        if start < 0:
            start = cursor
        end = start + len(paragraph)
        cursor = end
        paragraphs.append(
            {"paragraph_id": pid, "text": paragraph, "char_start": start, "char_end": end}
        )
        numbered_lines.append(f"{pid}: {paragraph}")

    obj = {
        "schema_version": "1.0.0",
        "study_id": study_id,
        "generated_at": _iso_now(),
        "paragraphs": paragraphs,
    }
    errs = validate(obj, load_schema("protocol_paragraph_index.schema.json"))
    if errs:
        raise ValueError("; ".join(errs))
    write_json(paths.local_protocol_paragraph_index_json(study_id, output_dir), obj)
    out_md = paths.local_protocol_paragraphs_md(study_id, output_dir)
    out_md.parent.mkdir(parents=True, exist_ok=True)
    out_md.write_text("# Paragraph-numbered protocol\n\n" + "\n\n".join(numbered_lines), encoding="utf-8")
    return obj


def _numbered_protocol_text(index_obj: Dict[str, Any]) -> str:
    lines: List[str] = []
    for p in index_obj.get("paragraphs", []):
        lines.append(f"{p['paragraph_id']}: {p['text']}")
    return "\n\n".join(lines)


def _validate_rules_reply(t: str) -> Optional[str]:
    if text_parse.BEGIN_RULE not in t:
        return "Must contain <<<BEGIN_RULE>>> blocks."
    if not text_parse.parse_rules_v2_blocks(t):
        return "Each rule needs RULE_TITLE, RULE_TEXT, PARAGRAPH_REFS."
    return None


def _validate_deviation_reply(t: str) -> Optional[str]:
    if text_parse.BEGIN_DEVIATION not in t:
        return "Must contain <<<BEGIN_DEVIATION>>> blocks."
    if not text_parse.parse_deviations_v2_blocks(t):
        return "Each deviation needs DEVIATION_TEXT and PARAGRAPH_REFS."
    return None


def _validate_dataset_reply(t: str) -> Optional[str]:
    if text_parse.BEGIN_DATASET not in t:
        return "Must contain <<<BEGIN_DATASET>>> blocks."
    if not text_parse.parse_acrf_dataset_blocks(t):
        return "Dataset blocks must include dataset name and columns."
    return None


def _validate_pseudo_reply(t: str) -> Optional[str]:
    if text_parse.BEGIN_PSEUDO not in t:
        return "Must contain <<<BEGIN_PSEUDO>>> blocks."
    if not text_parse.parse_pseudo_v2_blocks(t):
        return "Pseudo block must include PSEUDO_LOGIC."
    return None


def _validate_programmability_reply(t: str) -> Optional[str]:
    if not (t or "").strip():
        return "Empty programmability response."
    if "PROGRAMMABLE:" not in (t or "").upper():
        return "Must include PROGRAMMABLE: yes|no."
    return None


def _coerce_pseudo_logic_text(raw_text: str) -> str:
    """
    Accept either the legacy block format or plain text and return a safe pseudo string.
    This keeps the UI path resilient if the model drifts from strict block formatting.
    """
    parsed = text_parse.parse_pseudo_v2_blocks(raw_text)
    if parsed:
        return parsed[0]
    body = (raw_text or "").strip()
    if body:
        return body
    return "SELECT 1 WHERE 1=0 -- pseudo logic unavailable"


def _generate_single_pseudo_logic(
    *,
    study_id: str,
    rule_id: str,
    deviation_id: str,
    deviation_text: str,
    paragraph_refs: List[str],
    acrf_summary: str,
) -> str:
    system = load_prompt("pseudo_logic_v2_system")
    user = load_prompt("pseudo_logic_v2_user").format(
        study_id=study_id,
        rule_id=rule_id,
        deviation_id=deviation_id,
        deviation_text=deviation_text,
        paragraph_refs=", ".join(paragraph_refs),
        acrf_summary=acrf_summary,
    )
    try:
        return llm.generate_pseudo_logic_structured(
            system=system,
            user=user,
            max_repairs=2,
        )
    except ValueError:
        # Compatibility fallback for deployments without stable JSON parse behavior.
        reply = llm.chat_text_repairs(
            system=system,
            user=user,
            validate_reply=lambda t: None if (t or "").strip() else "Empty pseudo logic response.",
            max_repairs=1,
            label=f"v2-pseudo-fallback-{deviation_id}",
        )
        return _coerce_pseudo_logic_text(reply)


def _filter_refs(refs: List[str], valid: set[str]) -> List[str]:
    return [r for r in refs if r in valid]


def step1_acrf_summary_text(study_id: str, output_dir: Path) -> Dict[str, Any]:
    system = load_prompt("acrf_text_summary_v2_system")
    user_t = load_prompt("acrf_text_summary_v2_user")
    datasets: List[Dict[str, Any]] = []
    toc_dir = _acrf_sections_dir(study_id, output_dir)
    for section_md in sorted(toc_dir.glob("*.md")):
        section_id = section_md.stem
        user = user_t.format(
            study_id=study_id,
            section_id=section_id,
            section_path=section_id.replace("_", " "),
            section_markdown=section_md.read_text(encoding="utf-8")[:90000],
        )
        reply = llm.chat_text_repairs(
            system=system,
            user=user,
            validate_reply=_validate_dataset_reply,
            max_repairs=2,
            label=f"v2-acrf-{section_id}",
        )
        datasets.extend(text_parse.parse_acrf_dataset_blocks(reply))
    merged = {
        "schema_version": "1.0.0",
        "study_id": study_id,
        "generated_at": _iso_now(),
        "datasets": datasets,
    }
    out = paths.local_acrf_summary_text_merged(study_id, output_dir)
    write_json(out, merged)
    return merged


def step3_extract_rules(study_id: str, output_dir: Path) -> Dict[str, Any]:
    index_obj = read_json(paths.local_protocol_paragraph_index_json(study_id, output_dir))
    numbered = _numbered_protocol_text(index_obj)
    valid_ids = {p["paragraph_id"] for p in index_obj.get("paragraphs", [])}
    reply = llm.chat_text_repairs(
        system=load_prompt("rules_v2_system"),
        user=load_prompt("rules_v2_user").format(
            study_id=study_id, now=_iso_now(), protocol_paragraphs=numbered[:180000]
        ),
        validate_reply=_validate_rules_reply,
        max_repairs=2,
        label="v2-rules",
    )
    raw_rules = text_parse.parse_rules_v2_blocks(reply)
    rules: List[Dict[str, Any]] = []
    for i, r in enumerate(raw_rules, start=1):
        refs = _filter_refs(r.get("paragraph_refs", []), valid_ids)
        if not refs:
            continue
        rules.append(
            {
                "rule_id": f"rule-{i:03d}",
                "title": r["title"],
                "text": r["text"],
                "paragraph_refs": refs,
                "coverage_note": r.get("coverage_note", ""),
            }
        )
    parsed = {
        "schema_version": "1.0.0",
        "study_id": study_id,
        "generated_at": _iso_now(),
        "rules": rules,
    }
    errs = validate(parsed, load_schema("rules_parsed_v2.schema.json"))
    if errs:
        raise ValueError("; ".join(errs))
    raw_out = paths.local_rules_raw_txt(study_id, output_dir)
    raw_out.parent.mkdir(parents=True, exist_ok=True)
    raw_out.write_text(reply, encoding="utf-8")
    write_json(paths.local_rules_parsed_json(study_id, output_dir), parsed)
    return parsed


def _acrf_summary_text(study_id: str, output_dir: Path) -> str:
    summary = read_json(paths.local_acrf_summary_text_merged(study_id, output_dir))
    return json.dumps(summary, ensure_ascii=False, indent=2)


def _protocol_paragraph_text(study_id: str, output_dir: Path) -> str:
    index_obj = read_json(paths.local_protocol_paragraph_index_json(study_id, output_dir))
    return _numbered_protocol_text(index_obj)


def step4_5_extract_deviations(study_id: str, output_dir: Path) -> Dict[str, Any]:
    rules_obj = read_json(paths.local_rules_parsed_json(study_id, output_dir))
    index_obj = read_json(paths.local_protocol_paragraph_index_json(study_id, output_dir))
    valid_ids = {p["paragraph_id"] for p in index_obj.get("paragraphs", [])}
    protocol_paragraphs = _numbered_protocol_text(index_obj)[:180000]
    acrf_summary = _acrf_summary_text(study_id, output_dir)[:50000]
    system = load_prompt("deviations_v2_system")
    user_t = load_prompt("deviations_v2_user")
    all_raw: List[str] = []
    deviations: List[Dict[str, Any]] = []
    di = 1
    for rule in rules_obj.get("rules", []):
        user = user_t.format(
            study_id=study_id,
            rule_id=rule["rule_id"],
            rule_title=rule["title"],
            rule_text=rule["text"],
            rule_paragraph_refs=", ".join(rule["paragraph_refs"]),
            acrf_summary=acrf_summary,
            protocol_paragraphs=protocol_paragraphs,
        )
        reply = llm.chat_text_repairs(
            system=system,
            user=user,
            validate_reply=_validate_deviation_reply,
            max_repairs=2,
            label=f"v2-dev-{rule['rule_id']}",
        )
        all_raw.append(f"# {rule['rule_id']}\n{reply}")
        for dev in text_parse.parse_deviations_v2_blocks(reply):
            refs = _filter_refs(dev.get("paragraph_refs", []), valid_ids)
            if not refs:
                continue
            deviations.append(
                {
                    "deviation_id": f"dev-{di:04d}",
                    "rule_id": rule["rule_id"],
                    "text": dev["text"],
                    "paragraph_refs": refs,
                    "data_support_note": dev.get("data_support_note", ""),
                    "status": "pending",
                    "dm_comment": "",
                }
            )
            di += 1
    parsed = {
        "schema_version": "1.0.0",
        "study_id": study_id,
        "generated_at": _iso_now(),
        "deviations": deviations,
    }
    errs = validate(parsed, load_schema("deviations_parsed_v2.schema.json"))
    if errs:
        raise ValueError("; ".join(errs))
    raw_out = paths.local_deviations_raw_txt(study_id, output_dir)
    raw_out.parent.mkdir(parents=True, exist_ok=True)
    raw_out.write_text("\n\n".join(all_raw), encoding="utf-8")
    write_json(paths.local_deviations_parsed_json(study_id, output_dir), parsed)
    return parsed


def _write_simple_final_xlsx(final_obj: Dict[str, Any], out_path: Path) -> None:
    wb = Workbook()
    ws = wb.active
    ws.title = "Final Deviations"
    ws.append(["rule_id", "deviation_id", "rule_title", "deviation_text", "paragraph_refs", "pseudo_logic"])
    for item in final_obj.get("items", []):
        ws.append(
            [
                item.get("rule_id", ""),
                item.get("deviation_id", ""),
                item.get("rule_title", ""),
                item.get("deviation_text", ""),
                ", ".join(item.get("paragraph_refs", [])),
                item.get("pseudo_logic", ""),
            ]
        )
    out_path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(out_path)


def step8_generate_pseudo_logic(study_id: str, output_dir: Path) -> Dict[str, Any]:
    deviations_obj = read_json(paths.local_deviations_validated_json(study_id, output_dir))
    rules_obj = read_json(paths.local_rules_parsed_json(study_id, output_dir))
    rule_by_id = {r["rule_id"]: r for r in rules_obj.get("rules", [])}
    acrf_summary = _acrf_summary_text(study_id, output_dir)[:50000]
    items: List[Dict[str, Any]] = []
    raw_chunks: List[str] = []
    for dev in deviations_obj.get("deviations", []):
        if dev.get("status") != "accepted":
            continue
        rule = rule_by_id.get(dev.get("rule_id"), {})
        pseudo = _generate_single_pseudo_logic(
            study_id=study_id,
            rule_id=str(dev.get("rule_id", "")),
            deviation_id=str(dev.get("deviation_id", "")),
            deviation_text=dev.get("text", ""),
            paragraph_refs=list(dev.get("paragraph_refs", [])),
            acrf_summary=acrf_summary,
        )
        raw_chunks.append(pseudo)
        prog_reply = llm.chat_text_repairs(
            system=(
                "You are a data programmability assessor.\n"
                "Return exactly two lines:\n"
                "PROGRAMMABLE: yes|no\n"
                "RATIONALE: short reason grounded in provided deviation, pseudo logic, and aCRF summary."
            ),
            user=(
                f"study_id: {study_id}\n"
                f"rule_id: {dev.get('rule_id', '')}\n"
                f"deviation_id: {dev.get('deviation_id', '')}\n"
                f"deviation_text: {dev.get('text', '')}\n\n"
                f"pseudo_logic:\n{pseudo}\n\n"
                f"acrf_summary:\n{acrf_summary}\n"
            ),
            validate_reply=_validate_programmability_reply,
            max_repairs=1,
            label=f"v2-programmability-{dev.get('deviation_id', '')}",
        )
        programmable, rationale = text_parse.parse_programmability(prog_reply)
        items.append(
            {
                "deviation_id": dev["deviation_id"],
                "rule_id": dev["rule_id"],
                "rule_title": rule.get("title", ""),
                "pseudo_logic": pseudo,
                "programmable": programmable,
                "programmability_note": rationale,
                "status": "pending",
                "dm_comment": "",
            }
        )
    out = {
        "schema_version": "1.0.0",
        "study_id": study_id,
        "generated_at": _iso_now(),
        "items": items,
    }
    errs = validate(out, load_schema("pseudo_logic_v2.schema.json"))
    if errs:
        raise ValueError("; ".join(errs))
    raw_path = paths.local_pseudo_logic_raw_txt(study_id, output_dir)
    raw_path.parent.mkdir(parents=True, exist_ok=True)
    raw_path.write_text("\n\n".join(raw_chunks), encoding="utf-8")
    write_json(paths.local_pseudo_logic_validated_json(study_id, output_dir), out)
    write_json(paths.local_pseudo_logic_review_state(study_id, output_dir), out)
    return out


def generate_pseudo_logic_for_deviation(
    *,
    study_id: str,
    output_dir: Path,
    deviation: Dict[str, Any],
    rule_by_id: Optional[Dict[str, Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Generate pseudo logic for one deviation and return one pseudo item row."""
    if rule_by_id is None:
        rules_obj = read_json(paths.local_rules_parsed_json(study_id, output_dir))
        rule_by_id = {r["rule_id"]: r for r in rules_obj.get("rules", [])}
    rule = rule_by_id.get(str(deviation.get("rule_id", "")), {})
    acrf_summary = _acrf_summary_text(study_id, output_dir)[:50000]
    pseudo_logic = _generate_single_pseudo_logic(
        study_id=study_id,
        rule_id=str(deviation.get("rule_id", "")),
        deviation_id=str(deviation.get("deviation_id", "")),
        deviation_text=str(deviation.get("text", "")),
        paragraph_refs=list(deviation.get("paragraph_refs", [])),
        acrf_summary=acrf_summary,
    )
    prog_reply = llm.chat_text_repairs(
        system=(
            "You are a data programmability assessor.\n"
            "Return exactly two lines:\n"
            "PROGRAMMABLE: yes|no\n"
            "RATIONALE: short reason grounded in provided deviation, pseudo logic, and aCRF summary."
        ),
        user=(
            f"study_id: {study_id}\n"
            f"rule_id: {deviation.get('rule_id', '')}\n"
            f"deviation_id: {deviation.get('deviation_id', '')}\n"
            f"deviation_text: {deviation.get('text', '')}\n\n"
            f"pseudo_logic:\n{pseudo_logic}\n\n"
            f"acrf_summary:\n{acrf_summary}\n"
        ),
        validate_reply=_validate_programmability_reply,
        max_repairs=1,
        label=f"v2-programmability-{deviation.get('deviation_id', '')}",
    )
    programmable, rationale = text_parse.parse_programmability(prog_reply)
    return {
        "deviation_id": deviation.get("deviation_id", ""),
        "rule_id": deviation.get("rule_id", ""),
        "rule_title": rule.get("title", ""),
        "pseudo_logic": pseudo_logic,
        "programmable": programmable,
        "programmability_note": rationale,
        "status": "pending",
        "dm_comment": "",
    }


def step10_finalize(study_id: str, output_dir: Path) -> Dict[str, Any]:
    deviations_obj = read_json(paths.local_deviations_validated_json(study_id, output_dir))
    pseudo_obj = read_json(paths.local_pseudo_logic_validated_json(study_id, output_dir))
    rules_obj = read_json(paths.local_rules_parsed_json(study_id, output_dir))
    rule_by_id = {r["rule_id"]: r for r in rules_obj.get("rules", [])}
    pseudo_by_dev = {
        p["deviation_id"]: p
        for p in pseudo_obj.get("items", [])
        if p.get("status") == "accepted"
    }
    items: List[Dict[str, Any]] = []
    for dev in deviations_obj.get("deviations", []):
        if dev.get("status") != "accepted":
            continue
        p = pseudo_by_dev.get(dev.get("deviation_id"))
        if not p:
            continue
        rule = rule_by_id.get(dev.get("rule_id"), {})
        items.append(
            {
                "rule_id": dev["rule_id"],
                "deviation_id": dev["deviation_id"],
                "rule_title": rule.get("title", ""),
                "deviation_text": dev["text"],
                "paragraph_refs": dev["paragraph_refs"],
                "pseudo_logic": p["pseudo_logic"],
            }
        )
    out = {
        "schema_version": "1.0.0",
        "study_id": study_id,
        "generated_at": _iso_now(),
        "items": items,
    }
    errs = validate(out, load_schema("final_deviations_v2.schema.json"))
    if errs:
        raise ValueError("; ".join(errs))
    write_json(paths.local_final_deviations_json(study_id, output_dir), out)
    _write_simple_final_xlsx(out, paths.local_final_deviations_xlsx(study_id, output_dir))
    return out


def initialize_review_states(study_id: str, output_dir: Path) -> None:
    deviations = read_json(paths.local_deviations_parsed_json(study_id, output_dir))
    write_json(paths.local_deviations_review_state(study_id, output_dir), deviations)
    write_json(paths.local_deviations_validated_json(study_id, output_dir), deviations)


def _revision_validate(t: str) -> Optional[str]:
    if text_parse.BEGIN_REVISION not in t:
        return "Must contain <<<BEGIN_REVISION>>> block."
    if not text_parse.parse_revision_block(t):
        return "Revision block must include REVISED_TEXT."
    return None


def revise_text_with_comment(
    *,
    study_id: str,
    item_type: str,
    original_text: str,
    paragraph_refs: List[str],
    dm_comment: str,
    protocol_paragraphs: str,
    acrf_summary: str,
) -> Tuple[str, List[str]]:
    reply = llm.chat_text_repairs(
        system=load_prompt("revision_v2_system"),
        user=load_prompt("revision_v2_user").format(
            study_id=study_id,
            item_type=item_type,
            original_text=original_text,
            paragraph_refs=", ".join(paragraph_refs),
            dm_comment=dm_comment,
            protocol_paragraphs=protocol_paragraphs[:160000],
            acrf_summary=acrf_summary[:50000],
        ),
        validate_reply=_revision_validate,
        max_repairs=2,
        label=f"v2-revise-{item_type}",
    )
    parsed = text_parse.parse_revision_block(reply) or {"revised_text": original_text, "paragraph_refs": paragraph_refs}
    return parsed["revised_text"], list(parsed.get("paragraph_refs", paragraph_refs))


def apply_deviation_review_updates(
    *,
    study_id: str,
    output_dir: Path,
    state_obj: Dict[str, Any],
    updates: Dict[str, Dict[str, str]],
    run_revision_cycle: bool,
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """
    Apply in-memory review updates to deviation rows with field-preserving semantics.

    Only user-controlled fields are changed directly (status, dm_comment, text/refs when revised).
    Existing fields (including previously generated pseudo logic metadata) are retained.
    """
    rows = list(state_obj.get("deviations", []))
    protocol_text = _protocol_paragraph_text(study_id, output_dir)
    acrf_summary_text = _acrf_summary_text(study_id, output_dir)
    updated = 0
    revised = 0
    for row in rows:
        key = str(row.get("deviation_id", ""))
        update = updates.get(key)
        if not update:
            continue
        status = str(update.get("status", "")).strip() or str(row.get("status", "pending"))
        row["status"] = status
        row["dm_comment"] = str(update.get("dm_comment", row.get("dm_comment", "")))
        updated += 1
        if run_revision_cycle and status == "to_review" and row["dm_comment"].strip():
            revised_text, revised_refs = revise_text_with_comment(
                study_id=study_id,
                item_type="deviations",
                original_text=str(row.get("text", "")),
                paragraph_refs=list(row.get("paragraph_refs", [])),
                dm_comment=row["dm_comment"],
                protocol_paragraphs=protocol_text,
                acrf_summary=acrf_summary_text,
            )
            row["text"] = revised_text
            if revised_refs:
                row["paragraph_refs"] = revised_refs
            revised += 1
    state_obj["deviations"] = rows
    audit = {
        "study_id": study_id,
        "review_type": "deviations",
        "updated_rows": updated,
        "revised_rows": revised,
        "run_revision_cycle": run_revision_cycle,
    }
    return state_obj, audit


def run_steps(study_id: str, output_dir: Path, from_step: int, to_step: int) -> None:
    if from_step < 1 or to_step > 10 or from_step > to_step:
        raise ValueError("Invalid step range. Use 1..10 with from_step <= to_step.")
    for step in range(from_step, to_step + 1):
        print(f"[v2] Running step {step}")
        if step == 1:
            step1_acrf_summary_text(study_id, output_dir)
        elif step == 2:
            step2_protocol_paragraph_index(study_id, output_dir)
        elif step == 3:
            step3_extract_rules(study_id, output_dir)
        elif step == 4 or step == 5:
            step4_5_extract_deviations(study_id, output_dir)
            initialize_review_states(study_id, output_dir)
        elif step in (6, 7, 9):
            # UI-driven review steps; no automatic batch mutation here.
            continue
        elif step == 8:
            step8_generate_pseudo_logic(study_id, output_dir)
        elif step == 10:
            step10_finalize(study_id, output_dir)

"""Pipeline V2 orchestration with paragraph anchors and UI review artifacts."""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

LlmProgressCallback = Callable[..., None]

from pdcheck_factory import (
    acrf_field_dictionary,
    check_dedup,
    check_field_validate,
    check_normalize,
    check_validate,
    cost_usage,
    document_chat_agent,
    deviation_classify,
    deviation_consolidate,
    extraction_resolve,
    import_grounding,
    llm,
    paths,
    pipeline_metrics,
    programmability_classify,
    study_artifact_sync,
    text_parse,
)
from pdcheck_factory.model_output_log import build_model_output_log
from pdcheck_factory.pd_spec_export import write_final_pd_spec_xlsx
from pdcheck_factory.pd_spec_validate import validate_final_deviations
from pdcheck_factory.deviation_contract import pd_spec_field
from pdcheck_factory.pd_spec_import import parse_pd_spec_xlsx
from pdcheck_factory.json_util import load_schema, read_json, validate, write_json
from pdcheck_factory.prompt_loader import load_prompt


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _protocol_source(study_id: str, output_dir: Path) -> Path:
    p = extraction_resolve.resolve_protocol_rendered_source_md(study_id, output_dir)
    if not p.is_file():
        raise ValueError(f"Missing protocol source markdown: {p}")
    return p


def _acrf_sections_dir(study_id: str, output_dir: Path) -> Path:
    p = extraction_resolve.resolve_acrf_sections_toc_dir(study_id, output_dir)
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
    study_artifact_sync.mirror_upload_path(study_id, output_dir, paths.local_protocol_paragraph_index_json(study_id, output_dir))
    study_artifact_sync.mirror_upload_path(study_id, output_dir, out_md)
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


def _load_programmability_classification(study_id: str, output_dir: Path) -> Dict[str, Dict[str, Any]]:
    classified_path = paths.local_programmability_classified_json(study_id, output_dir)
    if classified_path.is_file():
        return programmability_classify.programmability_by_deviation_id(read_json(classified_path))
    return {}


def _normalize_manual_or_programmable(value: str) -> str:
    text = str(value or "").strip().lower()
    if text == "manual":
        return "Manual"
    if text == "programmable":
        return "Programmable"
    if text in {"partially programmable", "partially_programmable"}:
        return "Partially programmable"
    return str(value or "").strip()


def _classification_from_deviation(deviation: Dict[str, Any]) -> Dict[str, Any] | None:
    """Build classification from an explicit Manual / Partially programmable label on the deviation."""
    manual_label = _normalize_manual_or_programmable(pd_spec_field(deviation, "manual_or_programmable"))
    if manual_label == "Manual":
        return {
            "programmability": "manual",
            "manual_or_programmable": "Manual",
            "reason": "Marked as manual (not programmable).",
            "required_data": [],
        }
    if manual_label == "Partially programmable":
        return {
            "programmability": "partially_programmable",
            "manual_or_programmable": "Partially programmable",
            "reason": "Marked as partially programmable.",
            "required_data": [],
        }
    return None


def _is_non_programmable_classification(classification: Dict[str, Any] | None) -> bool:
    if not classification:
        return False
    programmability = str(classification.get("programmability", "")).strip().lower()
    label = _normalize_manual_or_programmable(
        str(classification.get("manual_or_programmable", "") or "")
    )
    return programmability == "manual" or label == "Manual"


def _resolve_classification_for_pseudo(
    *,
    study_id: str,
    output_dir: Path,
    deviation: Dict[str, Any],
    programmability_by_dev: Dict[str, Dict[str, Any]] | None = None,
) -> Dict[str, Any]:
    """Resolve programmability for pseudo generation; never LLM-classify explicit Manual rows."""
    from_dev = _classification_from_deviation(deviation)
    if _is_non_programmable_classification(from_dev):
        return from_dev  # type: ignore[return-value]
    if programmability_by_dev is None:
        programmability_by_dev = _load_programmability_classification(study_id, output_dir)
    classification = programmability_by_dev.get(str(deviation.get("deviation_id", "")))
    if classification:
        return classification
    if from_dev is not None:
        return from_dev
    return programmability_classify.classify_single_deviation(
        study_id=study_id,
        deviation=deviation,
        dictionary_obj=_acrf_field_dictionary(study_id, output_dir),
    )


def _manual_review_instructions(deviation_text: str) -> str:
    text = (deviation_text or "").strip()
    if not text:
        return "Confirm whether this deviation occurred for the participant."
    return f"Confirm whether the following deviation occurred: {text}"


def _build_pseudo_logic_item(
    *,
    study_id: str,
    output_dir: Path,
    deviation: Dict[str, Any],
    rule: Dict[str, Any],
    classification: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    dictionary_obj = _acrf_field_dictionary(study_id, output_dir)
    acrf_summary = _acrf_field_dictionary_text(study_id, output_dir)[:50000]
    programmability = str((classification or {}).get("programmability", "manual")).strip().lower()
    manual_or_programmable = _normalize_manual_or_programmable(
        str((classification or {}).get("manual_or_programmable", "Manual") or "")
    ) or "Manual"
    reason = str((classification or {}).get("reason", "")).strip()
    required_data = list((classification or {}).get("required_data", []) or [])
    deviation_label = _normalize_manual_or_programmable(
        pd_spec_field(deviation, "manual_or_programmable")
    )

    # Non-programmable deviations never get pseudo logic (always None).
    if (
        programmability == "manual"
        or manual_or_programmable == "Manual"
        or deviation_label == "Manual"
    ):
        item = {
            "deviation_id": deviation.get("deviation_id", ""),
            "rule_id": deviation.get("rule_id", ""),
            "rule_title": rule.get("title", ""),
            "pseudo_logic": None,
            "manual_review_instructions": _manual_review_instructions(str(deviation.get("text", ""))),
            "manual_or_programmable": "Manual",
            "programmable": False,
            "programmability_note": reason or "Not programmable.",
            "required_data": required_data,
            "status": "pending",
            "dm_comment": "",
        }
        return check_field_validate.apply_field_validation_to_item(item, dictionary_obj=dictionary_obj)

    pseudo_logic = _generate_single_pseudo_logic(
        study_id=study_id,
        rule_id=str(deviation.get("rule_id", "")),
        deviation_id=str(deviation.get("deviation_id", "")),
        deviation_text=str(deviation.get("text", "")),
        paragraph_refs=list(deviation.get("paragraph_refs", [])),
        acrf_summary=acrf_summary,
    )
    item = {
        "deviation_id": deviation.get("deviation_id", ""),
        "rule_id": deviation.get("rule_id", ""),
        "rule_title": rule.get("title", ""),
        "pseudo_logic": pseudo_logic,
        "manual_or_programmable": manual_or_programmable,
        "programmable": programmability == "programmable",
        "programmability_note": reason,
        "required_data": required_data,
        "status": "pending",
        "dm_comment": "",
    }
    if manual_or_programmable == "Partially programmable":
        item["manual_review_instructions"] = _manual_review_instructions(str(deviation.get("text", "")))
    return check_field_validate.apply_field_validation_to_item(item, dictionary_obj=dictionary_obj)


def _filter_refs(refs: List[str], valid: set[str]) -> List[str]:
    return [r for r in refs if r in valid]


def step1_acrf_summary_text(
    study_id: str,
    output_dir: Path,
    *,
    progress_callback: Optional[LlmProgressCallback] = None,
) -> Dict[str, Any]:
    system = load_prompt("acrf_text_summary_v2_system")
    user_t = load_prompt("acrf_text_summary_v2_user")
    datasets: List[Dict[str, Any]] = []
    toc_dir = _acrf_sections_dir(study_id, output_dir)
    section_files = sorted(toc_dir.glob("*.md"))
    total_sections = len(section_files)
    for index, section_md in enumerate(section_files):
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
        if progress_callback and total_sections > 0:
            progress_callback(
                phase="acrf-summary",
                current=index + 1,
                total=total_sections,
                unit="sections",
                label=section_id,
            )
    merged = {
        "schema_version": "1.0.0",
        "study_id": study_id,
        "generated_at": _iso_now(),
        "datasets": datasets,
    }
    out = paths.local_acrf_summary_text_merged(study_id, output_dir)
    write_json(out, merged)
    study_artifact_sync.mirror_upload_path(study_id, output_dir, out)
    return merged


def step1_acrf_summary_xls(
    study_id: str,
    output_dir: Path,
    *,
    workbook_bytes: bytes,
    file_format: str,
) -> Dict[str, Any]:
    """Deterministic aCRF summary builder for `.xls/.xlsx` workbooks."""

    from pdcheck_factory.acrf_xls_extract import build_acrf_summary_text_merged_from_workbook_bytes

    summary = build_acrf_summary_text_merged_from_workbook_bytes(
        workbook_bytes=workbook_bytes,
        file_format=file_format,
        study_id=study_id,
    )

    out = paths.local_acrf_summary_text_merged(study_id, output_dir)
    write_json(out, summary)
    study_artifact_sync.mirror_upload_path(study_id, output_dir, out)
    return summary


def step_acrf_field_dictionary(study_id: str, output_dir: Path) -> Dict[str, Any]:
    summary = read_json(paths.local_acrf_summary_text_merged(study_id, output_dir))
    dictionary = acrf_field_dictionary.build_field_dictionary(study_id=study_id, summary_obj=summary)
    errs = validate(dictionary, load_schema("acrf_field_dictionary.schema.json"))
    if errs:
        raise ValueError("; ".join(errs))
    out = paths.local_acrf_field_dictionary_json(study_id, output_dir)
    write_json(out, dictionary)
    study_artifact_sync.mirror_upload_path(study_id, output_dir, out)
    return dictionary


def step3_extract_rules(
    study_id: str,
    output_dir: Path,
    *,
    additional_instructions: str = "",
    progress_callback: Optional[LlmProgressCallback] = None,
    log_callback: Optional[Callable[[str], None]] = None,
) -> Dict[str, Any]:
    def _log(text: str) -> None:
        if log_callback is not None:
            log_callback(text)

    def _progress(*, current: int, label: str = "") -> None:
        if progress_callback is not None:
            progress_callback(
                phase="extract-rules",
                current=current,
                total=3,
                unit="phases",
                label=label,
            )

    index_obj = read_json(paths.local_protocol_paragraph_index_json(study_id, output_dir))
    paragraph_count = len(index_obj.get("paragraphs", []))
    numbered = _numbered_protocol_text(index_obj)
    valid_ids = {p["paragraph_id"] for p in index_obj.get("paragraphs", [])}
    extra = additional_instructions.strip() or "(none)"
    _log(f"Preparing protocol text ({paragraph_count} paragraphs)…")
    _progress(current=1, label="prepare")
    _log("Calling LLM for rule extraction…")
    _progress(current=2, label="llm")
    reply = llm.chat_text_repairs(
        system=load_prompt("rules_v2_system"),
        user=load_prompt("rules_v2_user").format(
            study_id=study_id,
            now=_iso_now(),
            protocol_paragraphs=numbered[:180000],
            additional_instructions=extra,
        ),
        validate_reply=_validate_rules_reply,
        max_repairs=2,
        label="v2-rules",
    )
    raw_rules = text_parse.parse_rules_v2_blocks(reply)
    _log(f"Parsed {len(raw_rules)} raw rule blocks")
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
    _log(f"Kept {len(rules)} rules with valid paragraph refs")
    _progress(current=3, label="parse")
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
    study_artifact_sync.mirror_upload_path(study_id, output_dir, raw_out)
    study_artifact_sync.mirror_upload_path(study_id, output_dir, paths.local_rules_parsed_json(study_id, output_dir))
    _log("Wrote rules_parsed.json")
    return parsed


def _acrf_summary_text(study_id: str, output_dir: Path) -> str:
    summary = read_json(paths.local_acrf_summary_text_merged(study_id, output_dir))
    return json.dumps(summary, ensure_ascii=False, indent=2)


def _acrf_field_dictionary(study_id: str, output_dir: Path) -> Dict[str, Any]:
    dictionary_path = paths.local_acrf_field_dictionary_json(study_id, output_dir)
    if dictionary_path.is_file():
        return read_json(dictionary_path)
    summary = read_json(paths.local_acrf_summary_text_merged(study_id, output_dir))
    return acrf_field_dictionary.build_field_dictionary(study_id=study_id, summary_obj=summary)


def _acrf_field_dictionary_text(study_id: str, output_dir: Path) -> str:
    return acrf_field_dictionary.compact_dictionary_for_prompt(_acrf_field_dictionary(study_id, output_dir))


def _protocol_paragraph_text(study_id: str, output_dir: Path) -> str:
    index_obj = read_json(paths.local_protocol_paragraph_index_json(study_id, output_dir))
    return _numbered_protocol_text(index_obj)


def _next_deviation_index(deviations: List[Dict[str, Any]]) -> int:
    max_idx = 0
    for dev in deviations:
        dev_id = str(dev.get("deviation_id", ""))
        match = re.match(r"dev-(\d+)$", dev_id)
        if match:
            max_idx = max(max_idx, int(match.group(1)))
    return max_idx + 1


def step4_5_extract_deviations(
    study_id: str,
    output_dir: Path,
    *,
    additional_instructions: str = "",
    progress_callback: Optional[LlmProgressCallback] = None,
    force: bool = False,
) -> Dict[str, Any]:
    rules_obj = read_json(paths.local_rules_parsed_json(study_id, output_dir))
    index_obj = read_json(paths.local_protocol_paragraph_index_json(study_id, output_dir))
    valid_ids = {p["paragraph_id"] for p in index_obj.get("paragraphs", [])}
    protocol_paragraphs = _numbered_protocol_text(index_obj)[:180000]
    acrf_summary = _acrf_field_dictionary_text(study_id, output_dir)[:50000]
    extra = additional_instructions.strip() or "(none)"
    system = load_prompt("deviations_v2_system")
    user_t = load_prompt("deviations_v2_user")
    partial_path = paths.local_deviations_parsed_json(study_id, output_dir)
    raw_out = paths.local_deviations_raw_txt(study_id, output_dir)

    deviations: List[Dict[str, Any]] = []
    completed_rule_ids: List[str] = []
    existing_raw_text = ""
    di = 1

    if not force and partial_path.is_file():
        try:
            checkpoint = read_json(partial_path)
            if checkpoint.get("partial") is True:
                deviations = list(checkpoint.get("deviations", []))
                completed_rule_ids = list(checkpoint.get("completed_rule_ids", []))
                di = _next_deviation_index(deviations)
                if raw_out.is_file():
                    existing_raw_text = raw_out.read_text(encoding="utf-8").strip()
        except (json.JSONDecodeError, OSError, ValueError, TypeError):
            deviations = []
            completed_rule_ids = []
            di = 1
            existing_raw_text = ""

    all_raw: List[str] = []
    rules = list(rules_obj.get("rules", []))
    total_rules = len(rules)
    completed_set = set(completed_rule_ids)
    rules_to_process = [r for r in rules if r["rule_id"] not in completed_set]
    for index, rule in enumerate(rules_to_process):
        user = user_t.format(
            study_id=study_id,
            rule_id=rule["rule_id"],
            rule_title=rule["title"],
            rule_text=rule["text"],
            rule_paragraph_refs=", ".join(rule["paragraph_refs"]),
            acrf_summary=acrf_summary,
            protocol_paragraphs=protocol_paragraphs,
            additional_instructions=extra,
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
        completed_rule_ids.append(rule["rule_id"])
        if progress_callback and total_rules > 0:
            progress_callback(
                phase="extract-deviations",
                current=len(completed_rule_ids),
                total=total_rules,
                unit="rules",
                label=str(rule["rule_id"]),
            )
        partial = {
            "schema_version": "1.0.0",
            "study_id": study_id,
            "generated_at": _iso_now(),
            "deviations": deviations,
            "completed_rule_ids": completed_rule_ids,
            "partial": True,
        }
        write_json(partial_path, partial)
        study_artifact_sync.mirror_upload_path(study_id, output_dir, partial_path)
    parsed = {
        "schema_version": "1.0.0",
        "study_id": study_id,
        "generated_at": _iso_now(),
        "deviations": deviations,
    }
    errs = validate(parsed, load_schema("deviations_parsed_v2.schema.json"))
    if errs:
        raise ValueError("; ".join(errs))
    raw_out.parent.mkdir(parents=True, exist_ok=True)
    new_raw = "\n\n".join(all_raw)
    if existing_raw_text and new_raw:
        combined_raw = f"{existing_raw_text}\n\n{new_raw}"
    elif existing_raw_text:
        combined_raw = existing_raw_text
    else:
        combined_raw = new_raw
    raw_out.write_text(combined_raw, encoding="utf-8")
    write_json(paths.local_deviations_parsed_json(study_id, output_dir), parsed)
    study_artifact_sync.mirror_upload_path(study_id, output_dir, raw_out)
    study_artifact_sync.mirror_upload_path(study_id, output_dir, paths.local_deviations_parsed_json(study_id, output_dir))
    return parsed


def step_normalize_checks(
    study_id: str,
    output_dir: Path,
    *,
    progress_callback: Optional[LlmProgressCallback] = None,
) -> Dict[str, Any]:
    deviations_obj = read_json(paths.local_deviations_parsed_json(study_id, output_dir))
    normalized = check_normalize.normalize_deviations(
        study_id=study_id,
        deviations=list(deviations_obj.get("deviations", [])),
        progress_callback=progress_callback,
    )
    errs = validate(normalized, load_schema("deviations_normalized_v2.schema.json"))
    if errs:
        raise ValueError("; ".join(errs))
    out = paths.local_deviations_normalized_json(study_id, output_dir)
    write_json(out, normalized)
    study_artifact_sync.mirror_upload_path(study_id, output_dir, out)
    return normalized


def step_deduplicate_checks(
    study_id: str,
    output_dir: Path,
) -> Dict[str, Any]:
    rules_obj = read_json(paths.local_rules_parsed_json(study_id, output_dir))
    deviations_obj = read_json(paths.local_deviations_parsed_json(study_id, output_dir))
    normalized_obj = read_json(paths.local_deviations_normalized_json(study_id, output_dir))
    rules_out, deviations_out, audit = check_dedup.deduplicate_checks(
        study_id=study_id,
        rules_obj=rules_obj,
        deviations_obj=deviations_obj,
        normalized_obj=normalized_obj,
        acrf_context=_acrf_field_dictionary_text(study_id, output_dir)[:50000],
    )
    rule_errs = validate(rules_out, load_schema("rules_parsed_v2.schema.json"))
    if rule_errs:
        raise ValueError("; ".join(rule_errs))
    deviation_errs = validate(deviations_out, load_schema("deviations_parsed_v2.schema.json"))
    if deviation_errs:
        raise ValueError("; ".join(deviation_errs))
    write_json(paths.local_rules_parsed_json(study_id, output_dir), rules_out)
    write_json(paths.local_deviations_parsed_json(study_id, output_dir), deviations_out)
    write_json(paths.local_check_dedup_audit_json(study_id, output_dir), audit)
    study_artifact_sync.mirror_upload_path(study_id, output_dir, paths.local_rules_parsed_json(study_id, output_dir))
    study_artifact_sync.mirror_upload_path(study_id, output_dir, paths.local_deviations_parsed_json(study_id, output_dir))
    study_artifact_sync.mirror_upload_path(study_id, output_dir, paths.local_check_dedup_audit_json(study_id, output_dir))
    return deviations_out


def step_classify_programmability(
    study_id: str,
    output_dir: Path,
    *,
    progress_callback: Optional[LlmProgressCallback] = None,
) -> Dict[str, Any]:
    deviations_obj = read_json(paths.local_deviations_parsed_json(study_id, output_dir))
    dictionary_obj = _acrf_field_dictionary(study_id, output_dir)
    classified = programmability_classify.classify_deviation_programmability(
        study_id=study_id,
        deviations=list(deviations_obj.get("deviations", [])),
        dictionary_obj=dictionary_obj,
        progress_callback=progress_callback,
    )
    errs = validate(classified, load_schema("programmability_classified_v2.schema.json"))
    if errs:
        raise ValueError("; ".join(errs))
    out = paths.local_programmability_classified_json(study_id, output_dir)
    write_json(out, classified)
    study_artifact_sync.mirror_upload_path(study_id, output_dir, out)
    return classified


def _classify_and_consolidate_deviations(
    study_id: str,
    output_dir: Path,
    parsed: Dict[str, Any],
) -> Dict[str, Any]:
    rules_path = paths.local_rules_parsed_json(study_id, output_dir)
    rules_by_id: Dict[str, Dict[str, Any]] = {}
    if rules_path.is_file():
        rules_obj = read_json(rules_path)
        rules_by_id = {r["rule_id"]: r for r in rules_obj.get("rules", [])}

    deviations = list(parsed.get("deviations", []))
    deviations, class_audit = deviation_classify.classify_deviations(
        study_id=study_id,
        deviations=deviations,
        rules_by_id=rules_by_id,
    )
    write_json(
        paths.local_deviation_classification_audit_json(study_id, output_dir),
        {
            "schema_version": "1.0.0",
            "study_id": study_id,
            "generated_at": _iso_now(),
            "items": class_audit,
        },
    )
    deviations, consolidate_audit = deviation_consolidate.consolidate_deviations(
        study_id=study_id,
        deviations=deviations,
    )
    write_json(
        paths.local_deviation_consolidation_audit_json(study_id, output_dir),
        {
            "schema_version": "1.0.0",
            "study_id": study_id,
            "generated_at": _iso_now(),
            "items": consolidate_audit,
        },
    )
    parsed = {
        "schema_version": "1.0.0",
        "study_id": study_id,
        "generated_at": _iso_now(),
        "deviations": deviations,
    }
    errs = validate(parsed, load_schema("deviations_parsed_v2.schema.json"))
    if errs:
        raise ValueError("; ".join(errs))
    write_json(paths.local_deviations_parsed_json(study_id, output_dir), parsed)
    study_artifact_sync.mirror_upload_path(
        study_id, output_dir, paths.local_deviations_parsed_json(study_id, output_dir)
    )
    study_artifact_sync.mirror_upload_path(
        study_id, output_dir, paths.local_deviation_classification_audit_json(study_id, output_dir)
    )
    study_artifact_sync.mirror_upload_path(
        study_id, output_dir, paths.local_deviation_consolidation_audit_json(study_id, output_dir)
    )
    return parsed


def step8_generate_pseudo_logic(
    study_id: str,
    output_dir: Path,
    *,
    progress_callback: Optional[LlmProgressCallback] = None,
) -> Dict[str, Any]:
    deviations_obj = read_json(paths.local_deviations_validated_json(study_id, output_dir))
    rules_obj = read_json(paths.local_rules_parsed_json(study_id, output_dir))
    rule_by_id = {r["rule_id"]: r for r in rules_obj.get("rules", [])}
    programmability_by_dev = _load_programmability_classification(study_id, output_dir)
    items: List[Dict[str, Any]] = []
    raw_chunks: List[str] = []
    accepted_deviations = [
        dev for dev in deviations_obj.get("deviations", []) if dev.get("status") == "accepted"
    ]
    total_accepted = len(accepted_deviations)
    for index, dev in enumerate(accepted_deviations):
        rule = rule_by_id.get(dev.get("rule_id"), {})
        # Skip LLM classify/generate for non-programmable (Manual) deviations.
        classification = _resolve_classification_for_pseudo(
            study_id=study_id,
            output_dir=output_dir,
            deviation=dev,
            programmability_by_dev=programmability_by_dev,
        )
        item = _build_pseudo_logic_item(
            study_id=study_id,
            output_dir=output_dir,
            deviation=dev,
            rule=rule,
            classification=classification,
        )
        if item.get("pseudo_logic"):
            raw_chunks.append(str(item["pseudo_logic"]))
        items.append(item)
        if progress_callback and total_accepted > 0:
            progress_callback(
                phase="pseudo-logic",
                current=index + 1,
                total=total_accepted,
                unit="deviations",
                label=str(dev.get("deviation_id", "")),
            )
    out = {
        "schema_version": "1.0.0",
        "study_id": study_id,
        "generated_at": _iso_now(),
        "items": items,
    }
    validation = check_validate.validate_check_artifacts(
        deviations_obj=deviations_obj,
        rules_obj=rules_obj,
        pseudo_obj=out,
        dictionary_obj=_acrf_field_dictionary(study_id, output_dir),
    )
    if not validation.ok:
        raise ValueError("; ".join(issue.message for issue in validation.errors))
    errs = validate(out, load_schema("pseudo_logic_v2.schema.json"))
    if errs:
        raise ValueError("; ".join(errs))
    raw_path = paths.local_pseudo_logic_raw_txt(study_id, output_dir)
    raw_path.parent.mkdir(parents=True, exist_ok=True)
    raw_path.write_text("\n\n".join(raw_chunks), encoding="utf-8")
    write_json(paths.local_pseudo_logic_validated_json(study_id, output_dir), out)
    write_json(paths.local_pseudo_logic_review_state(study_id, output_dir), out)
    study_artifact_sync.mirror_upload_path(study_id, output_dir, raw_path)
    study_artifact_sync.mirror_upload_path(study_id, output_dir, paths.local_pseudo_logic_validated_json(study_id, output_dir))
    study_artifact_sync.mirror_upload_path(study_id, output_dir, paths.local_pseudo_logic_review_state(study_id, output_dir))
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
    classification = _resolve_classification_for_pseudo(
        study_id=study_id,
        output_dir=output_dir,
        deviation=deviation,
    )
    return _build_pseudo_logic_item(
        study_id=study_id,
        output_dir=output_dir,
        deviation=deviation,
        rule=rule,
        classification=classification,
    )


def step10_finalize(study_id: str, output_dir: Path) -> Dict[str, Any]:
    deviations_obj = read_json(paths.local_deviations_validated_json(study_id, output_dir))
    pseudo_obj = read_json(paths.local_pseudo_logic_validated_json(study_id, output_dir))
    rules_path = paths.local_rules_parsed_json(study_id, output_dir)
    rule_by_id: Dict[str, Dict[str, Any]] = {}
    if rules_path.is_file():
        rules_obj = read_json(rules_path)
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
        rule_title = rule.get("title", "")
        if not rule_title:
            cat = pd_spec_field(dev, "protocol_deviation_category").strip()
            sub = pd_spec_field(dev, "protocol_deviation_sub_category").strip()
            rule_title = f"{cat} / {sub}".strip(" /")
        manual_or_programmable = (
            pd_spec_field(dev, "manual_or_programmable")
            or str(p.get("manual_or_programmable", "")).strip()
            or (
                "Programmable"
                if p.get("programmable") is True
                else "Manual"
                if p.get("programmable") is False
                else ""
            )
        )
        pseudo_logic = p.get("pseudo_logic")
        if manual_or_programmable == "Manual":
            pseudo_logic = None
        elif not str(pseudo_logic or "").strip():
            pseudo_logic = None
        row = {
            "rule_id": dev["rule_id"],
            "deviation_id": dev["deviation_id"],
            "rule_title": rule_title,
            "deviation_text": dev["text"],
            "paragraph_refs": dev["paragraph_refs"],
            "pseudo_logic": pseudo_logic,
            "protocol_deviation_category": pd_spec_field(dev, "protocol_deviation_category"),
            "protocol_deviation_sub_category": pd_spec_field(dev, "protocol_deviation_sub_category"),
            "classification": pd_spec_field(dev, "classification"),
            "manual_or_programmable": manual_or_programmable,
            "data_source": pd_spec_field(dev, "data_source") or "Rave",
            "programming_status": pd_spec_field(dev, "programming_status"),
            "programmable": p.get("programmable"),
        }
        if manual_or_programmable == "Manual":
            row["manual_review_instructions"] = str(
                p.get("manual_review_instructions")
                or _manual_review_instructions(str(dev.get("text", "")))
            )
        elif manual_or_programmable == "Partially programmable":
            row["manual_review_instructions"] = str(p.get("manual_review_instructions", ""))
        items.append(row)
    out = {
        "schema_version": "1.0.0",
        "study_id": study_id,
        "generated_at": _iso_now(),
        "items": items,
    }
    errs = validate(out, load_schema("final_deviations_v2.schema.json"))
    if errs:
        raise ValueError("; ".join(errs))

    paragraph_index: Dict[str, Any] = {}
    index_path = paths.local_protocol_paragraph_index_json(study_id, output_dir)
    if index_path.is_file():
        paragraph_index = read_json(index_path)
    rules_obj = read_json(rules_path) if rules_path.is_file() else {"rules": []}
    dictionary_obj = _acrf_field_dictionary(study_id, output_dir)
    dedup_audit: Dict[str, Any] = {}
    dedup_path = paths.local_check_dedup_audit_json(study_id, output_dir)
    if dedup_path.is_file():
        dedup_audit = read_json(dedup_path)
    programmability_obj: Dict[str, Any] = {}
    programmability_path = paths.local_programmability_classified_json(study_id, output_dir)
    if programmability_path.is_file():
        programmability_obj = read_json(programmability_path)
    validation = check_validate.validate_check_artifacts(
        deviations_obj=deviations_obj,
        rules_obj=rules_obj,
        pseudo_obj=pseudo_obj,
        dictionary_obj=dictionary_obj,
        final_obj=out,
        paragraph_index=paragraph_index,
    )
    if not validation.ok:
        raise ValueError("; ".join(issue.message for issue in validation.errors))
    validation = validate_final_deviations(out, paragraph_index=paragraph_index)
    if not validation.ok:
        raise ValueError(
            "; ".join(issue.message for issue in validation.errors)
        )

    metrics = pipeline_metrics.build_pipeline_metrics(
        study_id=study_id,
        deviations_obj=deviations_obj,
        rules_obj=rules_obj,
        pseudo_obj=pseudo_obj,
        dictionary_obj=dictionary_obj,
        dedup_audit=dedup_audit,
        programmability_obj=programmability_obj,
        final_obj=out,
        paragraph_index=paragraph_index,
    )
    write_json(paths.local_pipeline_quality_metrics_json(study_id, output_dir), metrics)
    study_artifact_sync.mirror_upload_path(
        study_id, output_dir, paths.local_pipeline_quality_metrics_json(study_id, output_dir)
    )

    class_audit: List[Dict[str, Any]] = []
    class_path = paths.local_deviation_classification_audit_json(study_id, output_dir)
    if class_path.is_file():
        class_audit = read_json(class_path).get("items", [])
    consolidate_audit: List[Dict[str, Any]] = []
    consolidate_path = paths.local_deviation_consolidation_audit_json(study_id, output_dir)
    if consolidate_path.is_file():
        consolidate_audit = read_json(consolidate_path).get("items", [])

    model_log = build_model_output_log(
        study_id=study_id,
        deviations=[dev for dev in deviations_obj.get("deviations", []) if dev.get("status") == "accepted"],
        rules_by_id=rule_by_id,
        pseudo_by_dev=pseudo_by_dev,
        classification_audit=class_audit,
        consolidation_audit=consolidate_audit,
    )
    write_json(paths.local_model_output_log_json(study_id, output_dir), model_log)

    write_json(paths.local_final_deviations_json(study_id, output_dir), out)
    write_final_pd_spec_xlsx(out, paths.local_final_deviations_xlsx(study_id, output_dir))
    study_artifact_sync.mirror_upload_path(study_id, output_dir, paths.local_final_deviations_json(study_id, output_dir))
    study_artifact_sync.mirror_upload_path(study_id, output_dir, paths.local_final_deviations_xlsx(study_id, output_dir))
    study_artifact_sync.mirror_upload_path(study_id, output_dir, paths.local_model_output_log_json(study_id, output_dir))
    return out


def initialize_review_states(study_id: str, output_dir: Path) -> None:
    from pdcheck_factory import review_sources

    deviations = read_json(paths.local_deviations_parsed_json(study_id, output_dir))
    generated_path = review_sources.review_state_path(
        study_id, output_dir, review_sources.REVIEW_SOURCE_GENERATED
    )
    write_json(generated_path, deviations)
    write_json(paths.local_deviations_review_state(study_id, output_dir), deviations)
    write_json(paths.local_deviations_validated_json(study_id, output_dir), deviations)
    study_artifact_sync.mirror_upload_path(study_id, output_dir, generated_path)
    study_artifact_sync.mirror_upload_path(study_id, output_dir, paths.local_deviations_review_state(study_id, output_dir))
    study_artifact_sync.mirror_upload_path(study_id, output_dir, paths.local_deviations_validated_json(study_id, output_dir))


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


def refine_single_deviation_with_comment(
    *,
    study_id: str,
    output_dir: Path,
    row: Dict[str, Any],
    dm_comment: str,
    run_revision_cycle: bool = True,
    chat_history: Optional[List[Dict[str, str]]] = None,
    also_generate_pseudo: bool = False,
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """
    Run Step 7 document-chat agent for one deviation and return (updated_row, audit).
    """
    updated_row = dict(row)
    updated_row["dm_comment"] = dm_comment
    status = str(updated_row.get("status", "pending")).strip() or "pending"
    updated_row["status"] = status

    revised = False
    assistant_message = ""
    response_type = "answer"
    agent_audit: Dict[str, Any] = {}
    missing_caveats: List[str] = []
    pseudo_item: Optional[Dict[str, Any]] = None

    if run_revision_cycle and dm_comment.strip():
        rules_obj = read_json(paths.local_rules_parsed_json(study_id, output_dir))
        rule_by_id = {str(r.get("rule_id", "")): r for r in rules_obj.get("rules", [])}
        rule_row = rule_by_id.get(str(updated_row.get("rule_id", "")), {})
        index_obj = read_json(paths.local_protocol_paragraph_index_json(study_id, output_dir))
        paragraph_by_ref = {str(p.get("paragraph_id", "")): p for p in index_obj.get("paragraphs", [])}
        valid_ids = set(paragraph_by_ref.keys())
        reference_sentences = document_chat_agent.build_reference_sentences(
            deviation_row=updated_row,
            rule_row=rule_row,
            paragraph_by_ref=paragraph_by_ref,
        )
        result = document_chat_agent.run_step7_message(
            study_id=study_id,
            user_question=dm_comment,
            deviation_row=updated_row,
            rule_row=rule_row,
            reference_sentences=reference_sentences,
            full_document=_protocol_paragraph_text(study_id, output_dir),
            acrf_summary=_acrf_summary_text(study_id, output_dir),
            chat_history=chat_history,
            valid_paragraph_ids=valid_ids,
            also_generate_pseudo=also_generate_pseudo,
        )
        assistant_message = result.assistant_message
        response_type = result.response_type
        agent_audit = result.to_audit_dict()
        missing_caveats = list(result.missing_caveats)
        if result.updated_row is not None:
            updated_row = dict(result.updated_row)
            updated_row["dm_comment"] = dm_comment
            updated_row["status"] = status
            revised = True
        if result.updated_pseudo is not None:
            pseudo_item = result.updated_pseudo

    audit = {
        "study_id": study_id,
        "review_type": "deviations",
        "deviation_id": str(updated_row.get("deviation_id", "")),
        "updated_rows": 1,
        "revised_rows": 1 if revised else 0,
        "run_revision_cycle": run_revision_cycle,
        "assistant_message": assistant_message,
        "response_type": response_type,
        "agent": agent_audit,
        "missing_caveats": missing_caveats if run_revision_cycle and dm_comment.strip() else [],
    }
    if pseudo_item is not None:
        audit["pseudo_item"] = pseudo_item
    return updated_row, audit


def generate_pseudo_logic_for_imported_deviation(
    *,
    study_id: str,
    output_dir: Path,
    deviation: Dict[str, Any],
) -> Dict[str, Any]:
    """Generate pseudo logic for one imported PD spec deviation."""
    category = pd_spec_field(deviation, "protocol_deviation_category")
    sub = pd_spec_field(deviation, "protocol_deviation_sub_category")
    rule_title = f"{category} / {sub}".strip(" /")
    rule = {"title": rule_title}
    classification = _resolve_classification_for_pseudo(
        study_id=study_id,
        output_dir=output_dir,
        deviation=deviation,
    )
    return _build_pseudo_logic_item(
        study_id=study_id,
        output_dir=output_dir,
        deviation=deviation,
        rule=rule,
        classification=classification,
    )


def _next_import_version(study_id: str, output_dir: Path) -> str:
    review_dir = paths.local_review_dir(study_id, output_dir)
    existing = sorted(review_dir.glob("deviations_import_*.json")) if review_dir.exists() else []
    return f"v{len(existing) + 1}"


def list_import_versions(study_id: str, output_dir: Path) -> Dict[str, Any]:
    review_dir = paths.local_review_dir(study_id, output_dir)
    imports: List[str] = []
    merged: List[str] = []
    if review_dir.exists():
        for path in sorted(review_dir.glob("deviations_import_*.json")):
            imports.append(path.stem.replace("deviations_import_", ""))
        for path in sorted(review_dir.glob("deviations_merged_*.json")):
            merged.append(path.stem.replace("deviations_merged_", ""))
    return {"imports": imports, "merged": merged}


def run_import_pd_spec_map(
    study_id: str,
    output_dir: Path,
    *,
    workbook_bytes: bytes | None = None,
    workbook_path: Path | None = None,
    version_label: str | None = None,
    pd_spec_import_mode: str = "map",
) -> Dict[str, Any]:
    """Parse PD spec workbook and map rows to review state without LLM grounding."""
    if workbook_bytes is None:
        if workbook_path is None or not workbook_path.is_file():
            workbook_path = paths.local_pd_spec_workbook(study_id, output_dir)
        if not workbook_path.is_file():
            raise ValueError("PD specifications workbook not found")
        workbook_bytes = workbook_path.read_bytes()

    import_version = (version_label or "").strip() or _next_import_version(study_id, output_dir)
    raw_deviations = parse_pd_spec_xlsx(workbook_bytes)

    snapshot = import_grounding.build_deviations_state(
        study_id=study_id,
        deviations=raw_deviations,
        import_version=import_version,
        source_type="import",
        pd_spec_import_mode=pd_spec_import_mode,
    )
    errs = validate(snapshot, load_schema("deviations_parsed_v2.schema.json"))
    if errs:
        raise ValueError("; ".join(errs))

    snapshot_path = paths.local_deviations_import_snapshot(study_id, output_dir, import_version)
    write_json(snapshot_path, snapshot)
    study_artifact_sync.mirror_upload_path(study_id, output_dir, snapshot_path)

    from pdcheck_factory import review_sources

    review_source_key = (
        review_sources.REVIEW_SOURCE_ENRICHED_PD_SPEC
        if pd_spec_import_mode == "enrich"
        else review_sources.REVIEW_SOURCE_IMPORTED_PD_SPEC
    )
    per_source_path = review_sources.review_state_path(study_id, output_dir, review_source_key)
    write_json(per_source_path, snapshot)
    study_artifact_sync.mirror_upload_path(study_id, output_dir, per_source_path)

    review_path = paths.local_deviations_review_state(study_id, output_dir)
    validated_path = paths.local_deviations_validated_json(study_id, output_dir)
    write_json(review_path, snapshot)
    write_json(validated_path, snapshot)
    study_artifact_sync.mirror_upload_path(study_id, output_dir, review_path)
    study_artifact_sync.mirror_upload_path(study_id, output_dir, validated_path)

    return {
        "import_version": import_version,
        "deviations": raw_deviations,
        "pd_spec_import_mode": pd_spec_import_mode,
        "review_source": review_source_key,
        "snapshot_path": str(snapshot_path),
    }


def run_import_pd_spec_enrich(
    study_id: str,
    output_dir: Path,
    *,
    workbook_bytes: bytes | None = None,
    workbook_path: Path | None = None,
    version_label: str | None = None,
    progress_callback: Optional[LlmProgressCallback] = None,
) -> Dict[str, Any]:
    """Parse PD spec workbook and run protocol enrichment (sequential LLM per deviation)."""
    from pdcheck_factory import protocol_enrichment

    return protocol_enrichment.run_protocol_enrichment(
        study_id,
        output_dir,
        workbook_bytes=workbook_bytes,
        workbook_path=workbook_path,
        version_label=version_label,
        progress_callback=progress_callback,
    )


def run_import_pd_spec_grounding(
    study_id: str,
    output_dir: Path,
    *,
    workbook_bytes: bytes | None = None,
    workbook_path: Path | None = None,
    version_label: str | None = None,
) -> Dict[str, Any]:
    """Parse PD spec workbook, ground deviations, generate pseudo logic; never writes rules_parsed."""
    index_path = paths.local_protocol_paragraph_index_json(study_id, output_dir)
    acrf_path = paths.local_acrf_summary_text_merged(study_id, output_dir)
    if not index_path.is_file():
        raise ValueError(f"Missing paragraph index: {index_path}")
    if not acrf_path.is_file():
        raise ValueError(f"Missing merged aCRF summary: {acrf_path}")

    if workbook_bytes is None:
        if workbook_path is None or not workbook_path.is_file():
            workbook_path = paths.local_pd_spec_workbook(study_id, output_dir)
        if not workbook_path.is_file():
            raise ValueError("PD specifications workbook not found")
        workbook_bytes = workbook_path.read_bytes()

    import_version = (version_label or "").strip() or _next_import_version(study_id, output_dir)
    raw_deviations = parse_pd_spec_xlsx(workbook_bytes)
    index_obj = read_json(index_path)
    acrf_summary = _acrf_summary_text(study_id, output_dir)

    grounded: List[Dict[str, Any]] = []
    for dev in raw_deviations:
        grounded.append(
            import_grounding.ground_imported_deviation(
                study_id=study_id,
                output_dir=output_dir,
                deviation=dev,
                index_obj=index_obj,
                acrf_summary=acrf_summary,
            )
        )

    pseudo_items: List[Dict[str, Any]] = []
    for dev in grounded:
        pseudo_items.append(
            generate_pseudo_logic_for_imported_deviation(
                study_id=study_id,
                output_dir=output_dir,
                deviation=dev,
            )
        )

    snapshot = import_grounding.build_deviations_state(
        study_id=study_id,
        deviations=grounded,
        import_version=import_version,
        source_type="import",
        pd_spec_import_mode="ground",
    )
    errs = validate(snapshot, load_schema("deviations_parsed_v2.schema.json"))
    if errs:
        raise ValueError("; ".join(errs))

    snapshot_path = paths.local_deviations_import_snapshot(study_id, output_dir, import_version)
    write_json(snapshot_path, snapshot)
    study_artifact_sync.mirror_upload_path(study_id, output_dir, snapshot_path)

    from pdcheck_factory import review_sources

    imported_path = review_sources.review_state_path(
        study_id, output_dir, review_sources.REVIEW_SOURCE_IMPORTED_PD_SPEC
    )
    write_json(imported_path, snapshot)
    study_artifact_sync.mirror_upload_path(study_id, output_dir, imported_path)

    review_path = paths.local_deviations_review_state(study_id, output_dir)
    validated_path = paths.local_deviations_validated_json(study_id, output_dir)
    write_json(review_path, snapshot)
    write_json(validated_path, snapshot)
    study_artifact_sync.mirror_upload_path(study_id, output_dir, review_path)
    study_artifact_sync.mirror_upload_path(study_id, output_dir, validated_path)

    pseudo_out = {
        "schema_version": "1.0.0",
        "study_id": study_id,
        "generated_at": _iso_now(),
        "items": pseudo_items,
    }
    pseudo_errs = validate(pseudo_out, load_schema("pseudo_logic_v2.schema.json"))
    if pseudo_errs:
        raise ValueError("; ".join(pseudo_errs))

    pseudo_review = paths.local_pseudo_logic_review_state(study_id, output_dir)
    pseudo_validated = paths.local_pseudo_logic_validated_json(study_id, output_dir)
    write_json(pseudo_review, pseudo_out)
    write_json(pseudo_validated, pseudo_out)
    study_artifact_sync.mirror_upload_path(study_id, output_dir, pseudo_review)
    study_artifact_sync.mirror_upload_path(study_id, output_dir, pseudo_validated)

    return {
        "import_version": import_version,
        "deviations": grounded,
        "pseudo_items": pseudo_items,
        "snapshot_path": str(snapshot_path),
    }


def merge_imported_deviation_snapshots(
    study_id: str,
    output_dir: Path,
    *,
    prior_version: str | None = None,
    new_version: str | None = None,
    merged_version_label: str | None = None,
) -> Dict[str, Any]:
    """Semantically merge two import snapshots into a third merged artifact."""
    versions = list_import_versions(study_id, output_dir)
    imports = versions.get("imports", [])
    if len(imports) < 2:
        raise ValueError("At least two import snapshots are required for merge")

    prior_v = prior_version or imports[-2]
    new_v = new_version or imports[-1]
    prior_path = paths.local_deviations_import_snapshot(study_id, output_dir, prior_v)
    new_path = paths.local_deviations_import_snapshot(study_id, output_dir, new_v)
    if not prior_path.is_file() or not new_path.is_file():
        raise ValueError("Import snapshot files not found for merge")

    prior_obj = read_json(prior_path)
    new_obj = read_json(new_path)

    system = load_prompt("import_merge_v2_system")
    user = load_prompt("import_merge_v2_user").format(
        study_id=study_id,
        prior_version=prior_v,
        new_version=new_v,
        prior_snapshot=json.dumps(prior_obj, ensure_ascii=False, indent=2)[:120000],
        new_snapshot=json.dumps(new_obj, ensure_ascii=False, indent=2)[:120000],
    )

    def _validate_merge(reply: str) -> Optional[str]:
        if text_parse.BEGIN_IMPORT_MERGE not in (reply or ""):
            return "Must contain <<<BEGIN_IMPORT_MERGE>>> blocks."
        if not text_parse.parse_import_merge_blocks(reply):
            return "Merge blocks missing required fields."
        return None

    reply = llm.chat_text_repairs(
        system=system,
        user=user,
        validate_reply=_validate_merge,
        max_repairs=2,
        label=f"import-merge-{prior_v}-{new_v}",
    )
    merged_rows_raw = text_parse.parse_import_merge_blocks(reply)
    index_obj = read_json(paths.local_protocol_paragraph_index_json(study_id, output_dir))
    valid_ids = {str(p.get("paragraph_id", "")) for p in index_obj.get("paragraphs", [])}

    prior_by_id = {str(d.get("deviation_id", "")): d for d in prior_obj.get("deviations", [])}
    new_by_id = {str(d.get("deviation_id", "")): d for d in new_obj.get("deviations", [])}

    merged_deviations: List[Dict[str, Any]] = []
    for row in merged_rows_raw:
        dev_id = str(row.get("deviation_id", ""))
        action = str(row.get("merge_action", ""))
        base = dict(new_by_id.get(dev_id) or prior_by_id.get(dev_id) or {})
        base.update(
            {
                "deviation_id": dev_id,
                "rule_id": base.get("rule_id") or f"pd-spec-{dev_id}",
                "text": row.get("text") or base.get("text", ""),
                "paragraph_refs": _filter_refs(list(row.get("paragraph_refs", []) or base.get("paragraph_refs", [])), valid_ids),
                "data_support_note": row.get("data_support_note") or base.get("data_support_note", ""),
                "protocol_deviation_category": row.get("protocol_deviation_category")
                or base.get("protocol_deviation_category", ""),
                "protocol_deviation_sub_category": row.get("protocol_deviation_sub_category")
                or base.get("protocol_deviation_sub_category", ""),
                "entry_source": "imported_pd_spec",
                "merge_action": action,
                "merge_source_ids": list(row.get("merge_source_ids", [])) or [dev_id],
                "status": base.get("status", "pending"),
                "dm_comment": base.get("dm_comment", ""),
                "grounding_error": base.get("grounding_error", ""),
            }
        )
        if not base.get("paragraph_refs") and base.get("grounding_error"):
            base["status"] = "to_review"
        merged_deviations.append(base)

    merged_version = (merged_version_label or "").strip() or f"{prior_v}_{new_v}"
    merged_state = import_grounding.build_deviations_state(
        study_id=study_id,
        deviations=merged_deviations,
        import_version=merged_version,
        source_type="merged",
    )
    merged_path = paths.local_deviations_merged_snapshot(study_id, output_dir, merged_version)
    write_json(merged_path, merged_state)
    study_artifact_sync.mirror_upload_path(study_id, output_dir, merged_path)

    return {
        "merged_version": merged_version,
        "prior_version": prior_v,
        "new_version": new_v,
        "deviation_count": len(merged_deviations),
        "merged_path": str(merged_path),
    }


def apply_active_deviations_source(
    study_id: str,
    output_dir: Path,
    source_key: str,
) -> Dict[str, Any]:
    """Copy selected import/merged snapshot into active review state."""
    key = (source_key or "").strip()
    if key.startswith("import_"):
        version = key[len("import_") :]
        src = paths.local_deviations_import_snapshot(study_id, output_dir, version)
    elif key.startswith("merged_"):
        version = key[len("merged_") :]
        src = paths.local_deviations_merged_snapshot(study_id, output_dir, version)
    else:
        raise ValueError(f"Unknown active deviations source: {source_key}")

    if not src.is_file():
        raise ValueError(f"Snapshot not found: {src}")

    state_obj = read_json(src)
    review_path = paths.local_deviations_review_state(study_id, output_dir)
    validated_path = paths.local_deviations_validated_json(study_id, output_dir)
    write_json(review_path, state_obj)
    write_json(validated_path, state_obj)
    study_artifact_sync.mirror_upload_path(study_id, output_dir, review_path)
    study_artifact_sync.mirror_upload_path(study_id, output_dir, validated_path)
    return {"activeDeviationsSource": key, "deviation_count": len(state_obj.get("deviations", []))}


def run_steps(study_id: str, output_dir: Path, from_step: int, to_step: int) -> None:
    if from_step < 1 or to_step > 14 or from_step > to_step:
        raise ValueError("Invalid step range. Use 1..14 with from_step <= to_step.")
    step_labels = {
        1: "acrf-summary-text",
        2: "acrf-field-dictionary",
        3: "index-protocol",
        4: "extract-rules",
        5: "extract-deviations",
        6: "normalize-checks",
        7: "deduplicate-checks",
        8: "classify-programmability",
        9: "review-placeholder",
        10: "review-placeholder",
        11: "review-placeholder",
        12: "generate-pseudo-logic",
        13: "review-placeholder",
        14: "review-and-finalize",
    }
    with cost_usage.session(study_id, output_dir):
        for step in range(from_step, to_step + 1):
            print(f"[v2] Running step {step}")
            with cost_usage.use_step(step_labels.get(step, f"v2-step-{step}")):
                if step == 1:
                    step1_acrf_summary_text(study_id, output_dir)
                elif step == 2:
                    step_acrf_field_dictionary(study_id, output_dir)
                elif step == 3:
                    step2_protocol_paragraph_index(study_id, output_dir)
                elif step == 4:
                    step3_extract_rules(study_id, output_dir)
                elif step == 5:
                    step4_5_extract_deviations(study_id, output_dir)
                elif step == 6:
                    step_normalize_checks(study_id, output_dir)
                elif step == 7:
                    step_deduplicate_checks(study_id, output_dir)
                    initialize_review_states(study_id, output_dir)
                elif step == 8:
                    step_classify_programmability(study_id, output_dir)
                elif step in (9, 10, 11, 13):
                    continue
                elif step == 12:
                    step8_generate_pseudo_logic(study_id, output_dir)
                elif step == 14:
                    step10_finalize(study_id, output_dir)
        cost_usage.print_cost_summary(cost_usage.load_artifact(study_id, output_dir))

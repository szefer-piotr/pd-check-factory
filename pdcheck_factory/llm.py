"""Azure OpenAI chat completions with JSON validation and repair."""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Literal, Optional, Type

from openai import AzureOpenAI
from pydantic import BaseModel, ConfigDict, Field

from pdcheck_factory import blob_io, text_parse
from pdcheck_factory.json_util import load_schema, validate
from pdcheck_factory.prompt_loader import load_prompt
from pdcheck_factory.protocol_markdown import format_section_for_prompt, validate_step1_output

STEP1_ACRF_MAX_CHARS = 60000
STEP1_SECTION_PROMPT_MAX_CHARS = 160000
ACRF_SECTION_PROMPT_MAX_CHARS = 120000


class _StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AcrfColumnValueRange(_StrictModel):
    min: str = ""
    max: str = ""


class AcrfColumnSummary(_StrictModel):
    column_name: str = Field(min_length=1)
    variable_type: Literal[
        "categorical", "numeric", "date", "datetime", "text", "boolean", "unknown"
    ]
    categorical_values: List[str] = Field(default_factory=list)
    value_range: AcrfColumnValueRange
    notes: str = ""


class AcrfDatasetSummary(_StrictModel):
    dataset_name: str = Field(min_length=1)
    columns: List[AcrfColumnSummary] = Field(default_factory=list)


class AcrfSectionSummaryOutput(_StrictModel):
    schema_version: Literal["1.0.0"]
    study_id: str = Field(min_length=1)
    generated_at: str
    acrf_section_id: str = Field(min_length=1)
    acrf_section_path: List[str] = Field(min_length=1)
    datasets: List[AcrfDatasetSummary] = Field(default_factory=list)


def _azure_client() -> AzureOpenAI:
    endpoint = blob_io.require_env("AZURE_OPENAI_ENDPOINT")
    api_key = os.getenv("AZURE_OPENAI_API_KEY")
    if not api_key:
        raise ValueError(
            "Missing AZURE_OPENAI_API_KEY (or use a token credential path not yet wired)."
        )
    api_version = os.getenv("OPENAI_API_VERSION", "2024-08-01-preview")
    return AzureOpenAI(
        azure_endpoint=endpoint,
        api_key=api_key,
        api_version=api_version,
    )


def deployment_name() -> str:
    return blob_io.require_env("AZURE_OPENAI_DEPLOYMENT")


STEP1_TEXT_SCHEMA_VERSION = "3.0.0"


def _log_chat_usage(resp: Any, deployment: str, label: str) -> None:
    usage = getattr(resp, "usage", None)
    prompt_tokens = getattr(usage, "prompt_tokens", None) if usage else None
    completion_tokens = getattr(usage, "completion_tokens", None) if usage else None
    total_tokens = getattr(usage, "total_tokens", None) if usage else None
    model_name = getattr(resp, "model", None)
    print(
        "[llm-text] "
        f"label={label!r} deployment={deployment!r} model={model_name!r} "
        f"prompt_tokens={prompt_tokens} completion_tokens={completion_tokens} "
        f"total_tokens={total_tokens}"
    )


def chat_text_repairs(
    *,
    system: str,
    user: str,
    validate_reply: Callable[[str], Optional[str]],
    max_repairs: int = 2,
    label: str = "text",
) -> str:
    """Plain-text chat completion with optional format repair turns."""
    client = _azure_client()
    deployment = deployment_name()
    repair_tmpl = load_prompt("repair_text_user")
    messages: List[Dict[str, str]] = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    last = ""
    for attempt in range(max_repairs + 1):
        resp = client.chat.completions.create(
            model=deployment,
            messages=messages,
            temperature=0.0,
        )
        _log_chat_usage(resp, deployment, label)
        last = (resp.choices[0].message.content or "").strip()
        err = validate_reply(last)
        if err is None:
            return last
        if attempt >= max_repairs:
            raise ValueError(err)
        messages.append({"role": "assistant", "content": last})
        messages.append(
            {"role": "user", "content": repair_tmpl.replace("__ERROR__", err)}
        )
    raise RuntimeError("chat_text_repairs exhausted retries")


def chat_json(
    *,
    system: str,
    user: str,
    response_model: Type[_StrictModel],
    validator: Callable[[Dict[str, Any]], List[str]],
    max_repairs: int = 2,
) -> Dict[str, Any]:
    client = _azure_client()
    deployment = deployment_name()
    repair_parse_tmpl = load_prompt("repair_parse_user")
    repair_schema_tmpl = load_prompt("repair_schema_user")

    messages: List[Dict[str, str]] = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]

    for attempt in range(max_repairs + 1):
        resp = client.beta.chat.completions.parse(
            model=deployment,
            messages=messages,
            response_format=response_model,
            temperature=0.0,
        )
        usage = getattr(resp, "usage", None)
        prompt_tokens = getattr(usage, "prompt_tokens", None) if usage else None
        completion_tokens = (
            getattr(usage, "completion_tokens", None) if usage else None
        )
        total_tokens = getattr(usage, "total_tokens", None) if usage else None
        response_model_name = getattr(resp, "model", None)
        print(
            "[llm-usage] "
            f"deployment={deployment!r} "
            f"model={response_model_name!r} "
            f"attempt={attempt + 1}/{max_repairs + 1} "
            f"prompt_tokens={prompt_tokens} "
            f"completion_tokens={completion_tokens} "
            f"total_tokens={total_tokens}"
        )
        message = resp.choices[0].message
        choice = message.content or ""
        parsed = message.parsed
        if parsed is None:
            refusal = message.refusal or "Model did not return parseable structured output."
            if attempt >= max_repairs:
                raise ValueError(refusal)
            messages.append({"role": "assistant", "content": choice or refusal})
            messages.append(
                {
                    "role": "user",
                    "content": repair_parse_tmpl.replace("__REFUSAL__", refusal),
                }
            )
            continue
        data = parsed.model_dump(mode="json")

        v_errs = validator(data)
        if not v_errs:
            return data

        if attempt >= max_repairs:
            raise ValueError("Schema validation failed: " + "; ".join(v_errs[:15]))

        messages.append({"role": "assistant", "content": choice})
        errors_block = "\n".join(v_errs[:25])
        messages.append(
            {
                "role": "user",
                "content": repair_schema_tmpl.replace("__ERRORS__", errors_block),
            }
        )

    raise RuntimeError("chat_json exhausted retries")


def _empty_step1(
    *,
    study_id: str,
    section: Dict[str, Any],
    now: str,
) -> Dict[str, Any]:
    return {
        "schema_version": STEP1_TEXT_SCHEMA_VERSION,
        "study_id": study_id,
        "generated_at": now,
        "section_id": section["section_id"],
        "section_path": list(section["section_path"]),
        "rules": [],
    }


def extract_protocol_section_step1(
    *,
    study_id: str,
    section: Dict[str, Any],
    acrf_markdown: Optional[str] = None,
    acrf_summary_context: Optional[str] = None,
    acrf_max_chars: int = STEP1_ACRF_MAX_CHARS,
    section_prompt_max_chars: int = STEP1_SECTION_PROMPT_MAX_CHARS,
) -> Dict[str, Any]:
    """
    Step 1 text pipeline: rules block → per-rule deviations → programmability → pseudo-SQL.
    """
    schema = load_schema("protocol_section_step1.schema.json")
    now = datetime.now(timezone.utc).isoformat()

    sentences = section.get("sentences") or []
    if not sentences:
        return _empty_step1(study_id=study_id, section=section, now=now)

    valid_ids: set[str] = {str(s["id"]) for s in sentences if s.get("id")}

    numbered = format_section_for_prompt(section)
    if len(numbered) > section_prompt_max_chars:
        numbered = (
            numbered[: section_prompt_max_chars]
            + "\n\n[TRUNCATED: section text exceeded character budget]\n"
        )

    section_path_json = json.dumps(section["section_path"], ensure_ascii=False)

    acrf_excerpt = ""
    if acrf_markdown:
        frag = acrf_markdown.strip()
        if len(frag) > acrf_max_chars:
            frag = frag[:acrf_max_chars] + "\n\n[TRUNCATED aCRF]\n"
        acrf_excerpt = frag

    summary_block = (acrf_summary_context or "").strip() or (
        "(No merged aCRF summary JSON available; infer conservatively from excerpt only.)"
    )

    def _validate_rules_text(t: str) -> Optional[str]:
        if not (t or "").strip():
            return "Empty model response."
        has_rule_blocks = text_parse.BEGIN_RULE in t
        if not has_rule_blocks and len((t or "").strip()) > 30:
            return (
                "Response must use <<<BEGIN_RULE>>> / <<<END_RULE>>> blocks as "
                "specified in the system message."
            )
        parsed = text_parse.parse_rule_blocks(t)
        if not parsed and has_rule_blocks:
            return (
                "Each rule block needs non-empty TITLE:, ATOMIC_REQUIREMENT:, "
                "and SENTENCE_REFS:."
            )
        return None

    system_rules = load_prompt("section_text_rules_system")
    user_rules = load_prompt("section_text_rules_user").format(
        study_id=study_id,
        now=now,
        section_id=section["section_id"],
        section_path_json=section_path_json,
        numbered_section=numbered,
    )
    rules_text = chat_text_repairs(
        system=system_rules,
        user=user_rules,
        validate_reply=_validate_rules_text,
        max_repairs=2,
        label="step1-rules",
    )
    raw_rules = text_parse.parse_rule_blocks(rules_text)
    filtered_rules: List[Dict[str, Any]] = []
    for rr in raw_rules:
        kept, _dropped = text_parse.filter_sentence_refs(
            list(rr.get("sentence_refs", [])), valid_ids
        )
        if not kept:
            continue
        filtered_rules.append(
            {
                "title": rr["title"],
                "atomic_requirement": rr["atomic_requirement"],
                "sentence_refs": kept,
            }
        )

    system_dev = load_prompt("section_text_deviations_system")
    out_rules: List[Dict[str, Any]] = []
    for ri, rule in enumerate(filtered_rules, start=1):
        rule_id = f"rule-{ri:03d}"
        refs_csv = ", ".join(rule["sentence_refs"])

        def _validate_dev_text(t: str) -> Optional[str]:
            if not (t or "").strip():
                return "Empty model response."
            if text_parse.BEGIN_DEVIATION not in t:
                return (
                    "Response must contain at least one "
                    "<<<BEGIN_DEVIATION>>> ... <<<END_DEVIATION>>> block."
                )
            devs = text_parse.parse_deviation_blocks(t)
            if not devs:
                return (
                    "Each deviation block needs SCENARIO:, EXAMPLE:, and SENTENCE_REFS: "
                    "with non-empty values."
                )
            return None

        user_dev = load_prompt("section_text_deviations_user").format(
            study_id=study_id,
            section_id=section["section_id"],
            numbered_section=numbered,
            rule_title=rule["title"],
            rule_requirement=rule["atomic_requirement"],
            rule_sentence_refs=refs_csv,
        )
        dev_text = chat_text_repairs(
            system=system_dev,
            user=user_dev,
            validate_reply=_validate_dev_text,
            max_repairs=2,
            label=f"step1-deviations-{rule_id}",
        )
        raw_devs = text_parse.parse_deviation_blocks(dev_text)
        candidate_deviations: List[Dict[str, Any]] = []
        for dj, dv in enumerate(raw_devs, start=1):
            kept_d, _ = text_parse.filter_sentence_refs(
                list(dv.get("sentence_refs", [])), valid_ids
            )
            if not kept_d:
                continue
            scenario = dv["scenario_description"]
            example = dv["example_violation_narrative"]
            dev_id = f"dev-{ri:03d}-{dj:02d}"

            def _validate_prog_text(t: str) -> Optional[str]:
                if not (t or "").strip():
                    return "Empty programmability response."
                if not re.search(r"PROGRAMMABLE:\s*(yes|no)\b", t, re.IGNORECASE):
                    return "Must include a line: PROGRAMMABLE: yes  or  PROGRAMMABLE: no"
                return None

            system_prog = load_prompt("section_text_programmability_system")
            user_prog = load_prompt("section_text_programmability_user").format(
                study_id=study_id,
                section_id=section["section_id"],
                scenario=scenario,
                example=example,
                sentence_refs=", ".join(kept_d),
                acrf_summary=summary_block,
                acrf_excerpt=acrf_excerpt or "(none)",
            )
            prog_text = chat_text_repairs(
                system=system_prog,
                user=user_prog,
                validate_reply=_validate_prog_text,
                max_repairs=1,
                label=f"step1-prog-{dev_id}",
            )
            programmable, _rationale = text_parse.parse_programmability(prog_text)
            pseudo_sql = "SELECT 1 WHERE 1=0 -- not programmable"
            if programmable:
                def _validate_pseudo_text(t: str) -> Optional[str]:
                    body = text_parse.parse_pseudo_sql_block(t)
                    if not body.strip():
                        return "Pseudo-SQL block is empty."
                    return None

                system_ps = load_prompt("section_text_pseudo_logic_system")
                user_ps = load_prompt("section_text_pseudo_logic_user").format(
                    study_id=study_id,
                    scenario=scenario,
                    example=example,
                    rationale=_rationale,
                    acrf_summary=summary_block,
                )
                ps_text = chat_text_repairs(
                    system=system_ps,
                    user=user_ps,
                    validate_reply=_validate_pseudo_text,
                    max_repairs=1,
                    label=f"step1-pseudo-{dev_id}",
                )
                pseudo_sql = text_parse.parse_pseudo_sql_block(ps_text)

            candidate_deviations.append(
                {
                    "deviation_id": dev_id,
                    "scenario_description": scenario,
                    "example_violation_narrative": example,
                    "sentence_refs": kept_d,
                    "programmable": programmable,
                    "pseudo_sql_logic": pseudo_sql,
                }
            )

        if not candidate_deviations:
            continue
        out_rules.append(
            {
                "rule_id": rule_id,
                "title": rule["title"],
                "atomic_requirement": rule["atomic_requirement"],
                "sentence_refs": list(rule["sentence_refs"]),
                "candidate_deviations": candidate_deviations,
            }
        )

    data: Dict[str, Any] = {
        "schema_version": STEP1_TEXT_SCHEMA_VERSION,
        "study_id": study_id,
        "generated_at": now,
        "section_id": section["section_id"],
        "section_path": list(section["section_path"]),
        "rules": out_rules,
    }
    errs = validate(data, schema)
    if errs:
        raise ValueError("Step 1 output failed schema validation: " + "; ".join(errs[:15]))
    sem = validate_step1_output(data, section)
    if sem:
        raise ValueError("Step 1 semantic validation failed: " + "; ".join(sem[:15]))
    return data


def _validate_dedup_judgement(d: Dict[str, Any]) -> List[str]:
    errs: List[str] = []
    conf = d.get("confidence")
    if not isinstance(conf, (int, float)):
        errs.append("confidence must be a number.")
    elif conf < 0.0 or conf > 1.0:
        errs.append("confidence must be between 0.0 and 1.0.")
    if not isinstance(d.get("rationale"), str) or not d.get("rationale", "").strip():
        errs.append("rationale must be a non-empty string.")
    return errs


def judge_step2_rule_duplicate(
    *,
    title_a: str,
    requirement_a: str,
    title_b: str,
    requirement_b: str,
    acrf_summary_context: Optional[str] = None,
) -> Dict[str, Any]:
    acrf_block = ""
    if acrf_summary_context and acrf_summary_context.strip():
        acrf_block = (
            "aCRF structured summary context:\n---\n"
            + acrf_summary_context.strip()
            + "\n---\n"
        )
    system = load_prompt("step2_rule_dedup_text_system")
    user = load_prompt("step2_rule_dedup_text_user").format(
        title_a=title_a,
        requirement_a=requirement_a,
        title_b=title_b,
        requirement_b=requirement_b,
        acrf_block=acrf_block or "(none)\n",
    )

    def _v(t: str) -> Optional[str]:
        if not t.strip():
            return "Empty response."
        d = text_parse.parse_dedup_judgement(t)
        errs = _validate_dedup_judgement(d)
        return errs[0] if errs else None

    text = chat_text_repairs(
        system=system,
        user=user,
        validate_reply=_v,
        max_repairs=1,
        label="step2-rule-dedup",
    )
    return text_parse.parse_dedup_judgement(text)


def judge_step2_deviation_duplicate(
    *,
    scenario_a: str,
    example_a: str,
    scenario_b: str,
    example_b: str,
    acrf_summary_context: Optional[str] = None,
) -> Dict[str, Any]:
    acrf_block = ""
    if acrf_summary_context and acrf_summary_context.strip():
        acrf_block = (
            "aCRF structured summary context:\n---\n"
            + acrf_summary_context.strip()
            + "\n---\n"
        )
    system = load_prompt("step2_deviation_dedup_text_system")
    user = load_prompt("step2_deviation_dedup_text_user").format(
        scenario_a=scenario_a,
        example_a=example_a,
        scenario_b=scenario_b,
        example_b=example_b,
        acrf_block=acrf_block or "(none)\n",
    )

    def _v(t: str) -> Optional[str]:
        if not t.strip():
            return "Empty response."
        d = text_parse.parse_dedup_judgement(t)
        errs = _validate_dedup_judgement(d)
        return errs[0] if errs else None

    text = chat_text_repairs(
        system=system,
        user=user,
        validate_reply=_v,
        max_repairs=1,
        label="step2-deviation-dedup",
    )
    return text_parse.parse_dedup_judgement(text)


def revalidate_deviation_with_dm_feedback(
    *,
    study_id: str,
    rule: Dict[str, Any],
    deviation: Dict[str, Any],
    dm_comments: str,
    protocol_context: str,
    context_mode: Literal["full_protocol", "sections_only"] = "full_protocol",
    acrf_summary_context: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Reconsider one Step 2 deviation using DM comments and protocol context."""
    now = datetime.now(timezone.utc).isoformat()
    pc = protocol_context.strip()
    rule_text = json.dumps(rule, ensure_ascii=False, indent=2)
    deviation_text = json.dumps(deviation, ensure_ascii=False, indent=2)
    system = load_prompt("step2_revalidate_text_system")
    user = load_prompt("step2_revalidate_text_user").format(
        study_id=study_id,
        now=now,
        context_mode=context_mode,
        rule_text=rule_text,
        deviation_text=deviation_text,
        dm_comments=dm_comments.strip(),
        protocol_context=pc,
        acrf_summary_context=(acrf_summary_context or "").strip(),
    )

    def _v(t: str) -> Optional[str]:
        if not t.strip():
            return "Empty response."
        items = text_parse.parse_revalidated_deviation_blocks(t)
        if not items:
            return (
                "No valid deviation blocks. Each block needs SCENARIO, EXAMPLE, "
                "SENTENCE_REFS, PROGRAMMABLE (yes|no), and PSEUDO_SQL."
            )
        for it in items:
            for ref in it.get("sentence_refs", []):
                if ref not in pc:
                    return f"Sentence ref {ref!r} must appear verbatim in protocol context."
        return None

    text = chat_text_repairs(
        system=system,
        user=user,
        validate_reply=_v,
        max_repairs=1,
        label="step2-revalidate",
    )
    parsed = text_parse.parse_revalidated_deviation_blocks(text)
    result: List[Dict[str, Any]] = []
    for idx, item in enumerate(parsed):
        base_id = deviation.get("deviation_id", "dev")
        suffix = "" if idx == 0 else f"-r{idx + 1}"
        psql = (item.get("pseudo_sql_logic") or "").strip()
        if not psql:
            psql = (deviation.get("pseudo_sql_logic") or "").strip()
        if not psql:
            psql = "SELECT 1 WHERE 1=0 -- pseudo_sql_logic not provided by revalidation"
        result.append(
            {
                "deviation_id": f"{base_id}{suffix}",
                "scenario_description": item["scenario_description"].strip(),
                "example_violation_narrative": item[
                    "example_violation_narrative"
                ].strip(),
                "sentence_refs": [s.strip() for s in item["sentence_refs"]],
                "programmable": bool(item["programmable"]),
                "pseudo_sql_logic": psql,
                "source_section_ids": list(deviation.get("source_section_ids", [])),
                "source_section_paths": list(deviation.get("source_section_paths", [])),
            }
        )
    return result


def summarize_acrf_section(
    *,
    study_id: str,
    acrf_section_id: str,
    acrf_section_path: List[str],
    section_markdown: str,
    section_prompt_max_chars: int = ACRF_SECTION_PROMPT_MAX_CHARS,
) -> Dict[str, Any]:
    """Summarize one aCRF section into dataset/column/value metadata."""
    schema = load_schema("acrf_section_summary.schema.json")
    now = datetime.now(timezone.utc).isoformat()
    section_body = section_markdown.strip()
    if len(section_body) > section_prompt_max_chars:
        section_body = (
            section_body[:section_prompt_max_chars]
            + "\n\n[TRUNCATED: aCRF section exceeded character budget]\n"
        )

    system = load_prompt("acrf_section_summary_system")
    user = load_prompt("acrf_section_summary_user").format(
        study_id=study_id,
        now=now,
        acrf_section_id=acrf_section_id,
        acrf_section_path_json=json.dumps(acrf_section_path, ensure_ascii=False),
        section_markdown=section_body,
    )

    def _v(d: Dict[str, Any]) -> List[str]:
        d.setdefault("generated_at", now)
        d.setdefault("study_id", study_id)
        d.setdefault("schema_version", "1.0.0")
        d["acrf_section_id"] = acrf_section_id
        d["acrf_section_path"] = list(acrf_section_path)
        return validate(d, schema)

    return chat_json(
        system=system,
        user=user,
        response_model=AcrfSectionSummaryOutput,
        validator=_v,
    )

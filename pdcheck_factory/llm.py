"""Azure OpenAI chat completions with JSON validation and repair."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Literal, Optional, Type

from openai import AzureOpenAI
from pydantic import BaseModel, ConfigDict, Field

from pdcheck_factory import blob_io
from pdcheck_factory.json_util import load_schema, validate
from pdcheck_factory.prompt_loader import load_prompt
from pdcheck_factory.protocol_markdown import format_section_for_prompt, validate_step1_output

STEP1_ACRF_MAX_CHARS = 60000
STEP1_SECTION_PROMPT_MAX_CHARS = 160000
ACRF_SECTION_PROMPT_MAX_CHARS = 120000


class _StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Step1Deviation(_StrictModel):
    deviation_id: str = Field(min_length=1)
    scenario_description: str = Field(min_length=1)
    example_violation_narrative: str = Field(min_length=1)
    sentence_refs: List[str] = Field(min_length=1)
    programmable: bool
    pseudo_sql_logic: str = Field(min_length=1)


class Step1Rule(_StrictModel):
    rule_id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    atomic_requirement: str = Field(min_length=1)
    sentence_refs: List[str] = Field(min_length=1)
    candidate_deviations: List[Step1Deviation] = Field(min_length=1)


class ProtocolSectionStep1Output(_StrictModel):
    schema_version: Literal["2.0.1"]
    study_id: str = Field(min_length=1)
    generated_at: str
    section_id: str = Field(min_length=1)
    section_path: List[str]
    rules: List[Step1Rule]


class Step2DedupJudgement(_StrictModel):
    is_duplicate: bool
    confidence: float = Field(ge=0.0, le=1.0)
    rationale: str = Field(min_length=1)


class Step2RevalidatedDeviation(_StrictModel):
    scenario_description: str = Field(min_length=1)
    example_violation_narrative: str = Field(min_length=1)
    sentence_refs: List[str] = Field(min_length=1)
    programmable: bool
    pseudo_sql_logic: str = Field(min_length=1)


class Step2RevalidatedDeviationResponse(_StrictModel):
    deviations: List[Step2RevalidatedDeviation] = Field(min_length=1)


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
        "schema_version": "2.0.1",
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
    Step 1 LLM: atomic rules + candidate deviations + examples for one manifest section.
    """
    schema = load_schema("protocol_section_step1.schema.json")
    now = datetime.now(timezone.utc).isoformat()

    sentences = section.get("sentences") or []
    if not sentences:
        return _empty_step1(study_id=study_id, section=section, now=now)

    numbered = format_section_for_prompt(section)
    if len(numbered) > section_prompt_max_chars:
        numbered = (
            numbered[: section_prompt_max_chars]
            + "\n\n[TRUNCATED: section text exceeded character budget]\n"
        )

    system = load_prompt("section_step1_system")
    section_path_json = json.dumps(section["section_path"], ensure_ascii=False)
    user = load_prompt("section_step1_user").format(
        study_id=study_id,
        now=now,
        section_id=section["section_id"],
        section_path_json=section_path_json,
        numbered_section=numbered,
    )
    if acrf_summary_context:
        user += (
            "\n\naCRF structured summary context "
            "(prioritize this over raw aCRF text when both are available):\n---\n"
        )
        user += acrf_summary_context.strip()
        user += "\n---\n"
    if acrf_markdown:
        frag = acrf_markdown.strip()
        if len(frag) > acrf_max_chars:
            frag = frag[:acrf_max_chars] + "\n\n[TRUNCATED aCRF]\n"
        user += "\n\nOptional annotated CRF context (do not name specific fields):\n---\n"
        user += frag
        user += "\n---\n"

    def _v(d: Dict[str, Any]) -> List[str]:
        d.setdefault("generated_at", now)
        d.setdefault("study_id", study_id)
        d.setdefault("schema_version", "2.0.1")
        d["section_id"] = section["section_id"]
        d["section_path"] = list(section["section_path"])
        errs = validate(d, schema)
        if errs:
            return errs
        return validate_step1_output(d, section)

    return chat_json(
        system=system,
        user=user,
        response_model=ProtocolSectionStep1Output,
        validator=_v,
    )


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
    system = load_prompt("step2_rule_dedup_system")
    user = load_prompt("step2_rule_dedup_user").format(
        title_a=title_a,
        requirement_a=requirement_a,
        title_b=title_b,
        requirement_b=requirement_b,
    )
    if acrf_summary_context:
        user += "\n\naCRF structured summary context:\n---\n"
        user += acrf_summary_context.strip()
        user += "\n---\n"
    return chat_json(
        system=system,
        user=user,
        response_model=Step2DedupJudgement,
        validator=_validate_dedup_judgement,
        max_repairs=1,
    )


def judge_step2_deviation_duplicate(
    *,
    scenario_a: str,
    example_a: str,
    scenario_b: str,
    example_b: str,
    acrf_summary_context: Optional[str] = None,
) -> Dict[str, Any]:
    system = load_prompt("step2_deviation_dedup_system")
    user = load_prompt("step2_deviation_dedup_user").format(
        scenario_a=scenario_a,
        example_a=example_a,
        scenario_b=scenario_b,
        example_b=example_b,
    )
    if acrf_summary_context:
        user += "\n\naCRF structured summary context:\n---\n"
        user += acrf_summary_context.strip()
        user += "\n---\n"
    return chat_json(
        system=system,
        user=user,
        response_model=Step2DedupJudgement,
        validator=_validate_dedup_judgement,
        max_repairs=1,
    )


def _validate_step2_revalidated_deviation(d: Dict[str, Any]) -> List[str]:
    errs: List[str] = []
    deviations = d.get("deviations")
    if not isinstance(deviations, list) or not deviations:
        return ["deviations must be a non-empty list."]
    for idx, dev in enumerate(deviations):
        if not isinstance(dev, dict):
            errs.append(f"deviations[{idx}] must be an object.")
            continue
        for key in ("scenario_description", "example_violation_narrative"):
            value = dev.get(key)
            if not isinstance(value, str) or not value.strip():
                errs.append(f"deviations[{idx}].{key} must be a non-empty string.")
        refs = dev.get("sentence_refs")
        if not isinstance(refs, list) or not refs:
            errs.append(f"deviations[{idx}].sentence_refs must be a non-empty list.")
        else:
            bad = [r for r in refs if not isinstance(r, str) or not r.strip()]
            if bad:
                errs.append(
                    f"deviations[{idx}].sentence_refs must contain non-empty strings."
                )
        if not isinstance(dev.get("programmable"), bool):
            errs.append(f"deviations[{idx}].programmable must be a boolean.")
        psql = dev.get("pseudo_sql_logic")
        if not isinstance(psql, str) or not psql.strip():
            errs.append(f"deviations[{idx}].pseudo_sql_logic must be a non-empty string.")
    return errs


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
    system = load_prompt("step2_revalidate_deviation_system")
    user = load_prompt("step2_revalidate_deviation_user").format(
        study_id=study_id,
        now=now,
        context_mode=context_mode,
        rule_json=json.dumps(rule, ensure_ascii=False, indent=2),
        deviation_json=json.dumps(deviation, ensure_ascii=False, indent=2),
        dm_comments=dm_comments.strip(),
        protocol_context=protocol_context.strip(),
        acrf_summary_context=(acrf_summary_context or "").strip(),
    )
    out = chat_json(
        system=system,
        user=user,
        response_model=Step2RevalidatedDeviationResponse,
        validator=_validate_step2_revalidated_deviation,
        max_repairs=1,
    )
    result: List[Dict[str, Any]] = []
    for idx, item in enumerate(out.get("deviations", [])):
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

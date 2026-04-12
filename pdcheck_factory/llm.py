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


class _StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Step1Rule(_StrictModel):
    rule_id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    atomic_requirement: str = Field(min_length=1)
    sentence_refs: List[str] = Field(min_length=1)


class Step1Deviation(_StrictModel):
    deviation_id: str = Field(min_length=1)
    parent_rule_id: str = Field(min_length=1)
    scenario_description: str = Field(min_length=1)
    example_violation_narrative: str = Field(min_length=1)
    sentence_refs: List[str] = Field(min_length=1)


class ProtocolSectionStep1Output(_StrictModel):
    schema_version: Literal["2.0.0"]
    study_id: str = Field(min_length=1)
    generated_at: str
    section_id: str = Field(min_length=1)
    section_path: List[str]
    rules: List[Step1Rule]
    candidate_deviations: List[Step1Deviation]


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
        "schema_version": "2.0.0",
        "study_id": study_id,
        "generated_at": now,
        "section_id": section["section_id"],
        "section_path": list(section["section_path"]),
        "rules": [],
        "candidate_deviations": [],
    }


def extract_protocol_section_step1(
    *,
    study_id: str,
    section: Dict[str, Any],
    acrf_markdown: Optional[str] = None,
    acrf_max_chars: int = 60000,
    section_prompt_max_chars: int = 160000,
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
        d.setdefault("schema_version", "2.0.0")
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

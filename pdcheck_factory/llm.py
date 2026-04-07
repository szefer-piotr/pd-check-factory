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


class _StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TimingAnchor(_StrictModel):
    anchor_type: Literal[
        "visit",
        "dose",
        "randomization",
        "screening",
        "baseline",
        "procedure",
        "unspecified",
    ]
    anchor_description: str = Field(min_length=1)


class AllowedWindow(_StrictModel):
    window_text: str = Field(min_length=1)
    window_type: Literal["exact", "plus_minus", "range", "before_after", "unspecified"]
    # Keep these nullable but required to satisfy strict schema requirements.
    lower_bound: Optional[float]
    upper_bound: Optional[float]
    unit: Optional[Literal["minutes", "hours", "days", "weeks"]]


class SourceEvidence(_StrictModel):
    chunk_id: str = Field(min_length=1)
    quote: str = Field(min_length=1)
    source_references: List[str]


class PDCandidate(_StrictModel):
    candidate_id: str = Field(pattern=r"^cand:[0-9]{5}$")
    deviation_title: str = Field(min_length=1)
    deviation_category: Literal[
        "visit_window",
        "procedure_missed",
        "assessment_timing",
        "dose_timing",
        "eligibility_operational",
        "treatment_compliance",
        "other",
    ]
    protocol_rule_description: str = Field(min_length=1)
    candidate_trigger_condition: str = Field(min_length=1)
    timing_anchor: TimingAnchor
    allowed_window: AllowedWindow
    exceptions_notes: str
    source_evidence: List[SourceEvidence] = Field(min_length=1)
    confidence: float = Field(ge=0.0, le=1.0)
    ambiguity_flag: bool
    reviewer_notes: str


class PDCandidateOutput(_StrictModel):
    schema_version: Literal["1.0.0"]
    study_id: str = Field(min_length=1)
    generated_at: str
    candidates: List[PDCandidate]


class PDLogicDraft(_StrictModel):
    candidate_id: str = Field(pattern=r"^cand:[0-9]{5}$")
    required_source_data_domain_hints: List[str] = Field(min_length=1)
    computable_trigger_expression_draft: str = Field(min_length=1)
    timing_evaluation_method: str = Field(min_length=1)
    window_evaluation_method: str = Field(min_length=1)
    exception_handling_logic: str
    assumptions: List[str]
    data_quality_risks: List[str]
    confidence: float = Field(ge=0.0, le=1.0)
    ambiguity_flag: bool
    reviewer_notes: str


class PDLogicOutput(_StrictModel):
    schema_version: Literal["1.0.0"]
    study_id: str = Field(min_length=1)
    generated_at: str
    logic_drafts: List[PDLogicDraft]


class ProtocolRule(_StrictModel):
    rule_id: str = Field(min_length=1, pattern=r"^rule:[a-zA-Z0-9._-]+$")
    title: str = Field(min_length=1)
    category: str
    plain_language_requirement: str = Field(min_length=1)
    applies_to: str
    source_hints: List[str]


class ProtocolRulesKBOutput(_StrictModel):
    schema_version: Literal["1.0.0"]
    study_id: str = Field(min_length=1)
    generated_at: str
    summary: str
    rules: List[ProtocolRule] = Field(min_length=1)


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
                    "content": (
                        "Return only an object that matches the required schema exactly. "
                        f"Previous issue: {refusal}"
                    ),
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
        messages.append(
            {
                "role": "user",
                "content": (
                    "Fix the JSON to satisfy the schema. Validation errors:\n"
                    + "\n".join(v_errs[:25])
                    + "\nReturn only the corrected JSON object."
                ),
            }
        )

    raise RuntimeError("chat_json exhausted retries")


def extract_protocol_rules_kb(*, study_id: str, protocol_markdown: str) -> Dict[str, Any]:
    schema = load_schema("protocol_rules_kb.schema.json")
    now = datetime.now(timezone.utc).isoformat()

    system = (
        "You extract operational study rules from a clinical trial protocol. "
        "Output must be a single JSON object matching the caller constraints. "
        "Focus on requirements every enrolled subject must satisfy during the trial "
        "(visits/windows, assessments, dosing compliance, prohibited meds, eligibility operations, "
        "withdrawal rules, etc.). Each rule must be actionable and self-contained."
    )
    user = (
        f'study_id: "{study_id}"\n'
        f'generated_at (use exactly this ISO timestamp): "{now}"\n'
        f'schema_version must be exactly "1.0.0".\n'
        "rules[].rule_id must be unique strings like rule:001, rule:002, ...\n"
        "Return JSON keys: schema_version, study_id, generated_at, optional summary, rules (array).\n\n"
        "Protocol markdown follows.\n---\n"
        f"{protocol_markdown[:190000]}"
    )

    def _v(d: Dict[str, Any]) -> List[str]:
        d.setdefault("generated_at", now)
        d.setdefault("study_id", study_id)
        d.setdefault("schema_version", "1.0.0")
        return validate(d, schema)

    return chat_json(
        system=system,
        user=user,
        response_model=ProtocolRulesKBOutput,
        validator=_v,
    )


def draft_pd_candidates(
    *,
    study_id: str,
    rules_kb: Dict[str, Any],
    acrf_markdown: str,
) -> Dict[str, Any]:
    schema = load_schema("pd_candidate_output.schema.json")
    now = datetime.now(timezone.utc).isoformat()
    rule_count = len(rules_kb.get("rules", []))

    system = (
        "You are a clinical data management expert. Given structured protocol rules and an annotated CRF "
        "(aCRF) describing forms/fields, propose protocol deviation CANDIDATES: ways a participant could "
        "fail to meet each rule using data capture implied by the aCRF. "
        "Coverage is mandatory: generate at least one candidate for every protocol rule provided. "
        "Every candidate_id must match pattern cand:##### with five digits (cand:00001, cand:00002, ...). "
        "Use deviation categories only from the schema enum. "
        "For source_evidence, use chunk_id 'protocol' and quote short verbatim protocol text when possible, "
        "otherwise paraphrase clearly; source_references can be empty or short hints."
    )
    user = (
        f'study_id: "{study_id}"\n'
        f'generated_at: "{now}"\n'
        "schema_version must be exactly \"1.0.0\".\n"
        f"The protocol has {rule_count} extracted rules.\n"
        f"Return at least {rule_count} candidates (minimum one candidate per rule).\n"
        "Return a JSON object with keys schema_version, study_id, generated_at, candidates.\n\n"
        "Protocol rules KB (JSON):\n"
        + json.dumps(rules_kb, ensure_ascii=False)[:120000]
        + "\n\naCRF markdown (may be truncated):\n---\n"
        + acrf_markdown[:120000]
    )

    def _v(d: Dict[str, Any]) -> List[str]:
        d.setdefault("generated_at", now)
        d.setdefault("study_id", study_id)
        d.setdefault("schema_version", "1.0.0")
        errs = validate(d, schema)
        if errs:
            return errs

        candidates = d.get("candidates", [])
        if len(candidates) < rule_count:
            return [
                "Insufficient candidate coverage: expected at least "
                f"{rule_count} candidates (>=1 per protocol rule), got {len(candidates)}."
            ]

        ids = [c.get("candidate_id") for c in candidates]
        if len(set(ids)) != len(ids):
            return ["candidate_id values must be unique across candidates."]
        return []

    return chat_json(
        system=system,
        user=user,
        response_model=PDCandidateOutput,
        validator=_v,
    )


def draft_pd_logic(
    *,
    study_id: str,
    rules_kb: Dict[str, Any],
    acrf_markdown: str,
    candidates: Dict[str, Any],
) -> Dict[str, Any]:
    schema = load_schema("pd_logic_output.schema.json")
    now = datetime.now(timezone.utc).isoformat()

    all_slim = []
    for c in candidates.get("candidates", []):
        all_slim.append(
            {
                "candidate_id": c.get("candidate_id"),
                "deviation_title": c.get("deviation_title"),
                "protocol_rule_description": c.get("protocol_rule_description"),
                "candidate_trigger_condition": c.get("candidate_trigger_condition"),
                "deviation_category": c.get("deviation_category"),
            }
        )

    system = (
        "You draft operational detection logic for protocol deviation candidates. "
        "For each candidate_id from the input list, output one logic_drafts entry with the SAME candidate_id. "
        "required_source_data_domain_hints must name concrete domains (e.g. visit dates, dosing, labs, "
        "procedures) informed by the aCRF. "
        "computable_trigger_expression_draft should be plain-language or pseudo-SQL describing HOW to detect "
        "the deviation from collected data - not executable code. "
        "timings and windows: timing_evaluation_method and window_evaluation_method must be non-empty strings."
    )
    def _v_for_ids(expected_ids: set[str], d: Dict[str, Any]) -> List[str]:
        d.setdefault("generated_at", now)
        d.setdefault("study_id", study_id)
        d.setdefault("schema_version", "1.0.0")
        errs = validate(d, schema)
        if errs:
            return errs
        out_ids = {x.get("candidate_id") for x in d.get("logic_drafts", [])}
        missing = expected_ids - out_ids
        extra = out_ids - expected_ids
        if missing or extra:
            return [
                f"logic_drafts candidate_ids must match candidates exactly. "
                f"missing={sorted(missing)[:5]} extra={sorted(extra)[:5]}"
            ]
        return []

    def _run_chunk(chunk: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        ids = {c["candidate_id"] for c in chunk if "candidate_id" in c}
        id_list = ", ".join(sorted(ids))
        user = (
            f'study_id: "{study_id}"\n'
            f'generated_at: "{now}"\n'
            "schema_version must be exactly \"1.0.0\".\n"
            "Return JSON with keys schema_version, study_id, generated_at, logic_drafts.\n"
            f"Create exactly one logic_drafts entry for each of these candidate_ids ({len(ids)} total): {id_list}\n"
            "Do not include any extra candidate_ids.\n\n"
            "Candidates summary:\n"
            + json.dumps(chunk, ensure_ascii=False)[:80000]
            + "\n\nProtocol rules KB:\n"
            + json.dumps(rules_kb, ensure_ascii=False)[:60000]
            + "\n\naCRF markdown:\n---\n"
            + acrf_markdown[:80000]
        )
        out = chat_json(
            system=system,
            user=user,
            response_model=PDLogicOutput,
            validator=lambda d: _v_for_ids(ids, d),
        )
        return out.get("logic_drafts", [])

    # Large candidate sets can cause partial outputs; chunking improves coverage reliability.
    chunk_size = 15
    merged_logic_drafts: List[Dict[str, Any]] = []
    for i in range(0, len(all_slim), chunk_size):
        chunk = all_slim[i : i + chunk_size]
        if not chunk:
            continue
        merged_logic_drafts.extend(_run_chunk(chunk))

    return {
        "schema_version": "1.0.0",
        "study_id": study_id,
        "generated_at": now,
        "logic_drafts": merged_logic_drafts,
    }

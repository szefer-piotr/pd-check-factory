"""Azure OpenAI chat completions with JSON validation and repair."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List

from openai import AzureOpenAI

from pdcheck_factory import blob_io
from pdcheck_factory.json_util import load_schema, parse_json_object, validate


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
        resp = client.chat.completions.create(
            model=deployment,
            messages=messages,
            response_format={"type": "json_object"},
            temperature=0.2,
        )
        choice = resp.choices[0].message.content or ""
        try:
            data = parse_json_object(choice)
        except json.JSONDecodeError as e:
            err = f"Invalid JSON: {e}"
            if attempt >= max_repairs:
                raise ValueError(err) from e
            messages.append({"role": "assistant", "content": choice})
            messages.append(
                {
                    "role": "user",
                    "content": f"Your previous reply was not valid JSON. {err} Return only a single JSON object.",
                }
            )
            continue

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

    return chat_json(system=system, user=user, validator=_v)


def draft_pd_candidates(
    *,
    study_id: str,
    rules_kb: Dict[str, Any],
    acrf_markdown: str,
) -> Dict[str, Any]:
    schema = load_schema("pd_candidate_output.schema.json")
    now = datetime.now(timezone.utc).isoformat()

    system = (
        "You are a clinical data management expert. Given structured protocol rules and an annotated CRF "
        "(aCRF) describing forms/fields, propose protocol deviation CANDIDATES: ways a participant could "
        "fail to meet each rule using data capture implied by the aCRF. "
        "Every candidate_id must match pattern cand:##### with five digits (cand:00001, cand:00002, ...). "
        "Use deviation categories only from the schema enum. "
        "For source_evidence, use chunk_id 'protocol' and quote short verbatim protocol text when possible, "
        "otherwise paraphrase clearly; source_references can be empty or short hints."
    )
    user = (
        f'study_id: "{study_id}"\n'
        f'generated_at: "{now}"\n'
        "schema_version must be exactly \"1.0.0\".\n"
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
        return validate(d, schema)

    return chat_json(system=system, user=user, validator=_v)


def draft_pd_logic(
    *,
    study_id: str,
    rules_kb: Dict[str, Any],
    acrf_markdown: str,
    candidates: Dict[str, Any],
) -> Dict[str, Any]:
    schema = load_schema("pd_logic_output.schema.json")
    now = datetime.now(timezone.utc).isoformat()

    slim = []
    for c in candidates.get("candidates", []):
        slim.append(
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
    user = (
        f'study_id: "{study_id}"\n'
        f'generated_at: "{now}"\n'
        "schema_version must be exactly \"1.0.0\".\n"
        "Return JSON with keys schema_version, study_id, generated_at, logic_drafts — one draft per candidate, "
        "same candidate_id values, no extras.\n\n"
        "Candidates summary:\n"
        + json.dumps(slim, ensure_ascii=False)[:80000]
        + "\n\nProtocol rules KB:\n"
        + json.dumps(rules_kb, ensure_ascii=False)[:60000]
        + "\n\naCRF markdown:\n---\n"
        + acrf_markdown[:80000]
    )

    ids = {c["candidate_id"] for c in candidates.get("candidates", []) if "candidate_id" in c}

    def _v(d: Dict[str, Any]) -> List[str]:
        d.setdefault("generated_at", now)
        d.setdefault("study_id", study_id)
        d.setdefault("schema_version", "1.0.0")
        errs = validate(d, schema)
        if errs:
            return errs
        out_ids = {x.get("candidate_id") for x in d.get("logic_drafts", [])}
        missing = ids - out_ids
        extra = out_ids - ids
        if missing or extra:
            return [
                f"logic_drafts candidate_ids must match candidates exactly. "
                f"missing={sorted(missing)[:5]} extra={sorted(extra)[:5]}"
            ]
        return []

    return chat_json(system=system, user=user, validator=_v)

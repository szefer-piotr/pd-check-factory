"""Deduplicate rules and deviations using normalized keys and semantic judges."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone
from difflib import SequenceMatcher
from typing import Any, Callable, Dict, List, Optional, Tuple

from pdcheck_factory import llm
from pdcheck_factory.check_normalize import dedup_key_from_normalized
from pdcheck_factory.deviation_classify import classify_deviations
from pdcheck_factory.deviation_consolidate import consolidate_deviations

_TOKEN_RE = re.compile(r"[a-z0-9]+")


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _norm_text(value: str) -> str:
    return " ".join(_TOKEN_RE.findall((value or "").lower()))


def _text_ratio(a: str, b: str) -> float:
    return SequenceMatcher(None, _norm_text(a), _norm_text(b)).ratio()


@dataclass
class _RuleRow:
    rule_id: str
    title: str
    text: str
    paragraph_refs: List[str]


def _candidate_rule_pair(a: _RuleRow, b: _RuleRow) -> bool:
    if _text_ratio(a.text, b.text) >= 0.62:
        return True
    if _text_ratio(a.title, b.title) >= 0.80:
        return True
    return False


def _candidate_deviation_pair(a: Dict[str, Any], b: Dict[str, Any]) -> bool:
    key_a = dedup_key_from_normalized(a)
    key_b = dedup_key_from_normalized(b)
    if key_a and key_b and key_a == key_b:
        return True
    if _text_ratio(str(a.get("text", "")), str(b.get("text", ""))) >= 0.65:
        return True
    return False


def _dedup_rows(
    rows: List[Any],
    *,
    candidate_pair: Callable[[Any, Any], bool],
    is_duplicate: Callable[[Any, Any], bool],
) -> List[List[Any]]:
    clusters: List[List[Any]] = []
    for row in rows:
        matched_idx = -1
        for i, cluster in enumerate(clusters):
            rep = cluster[0]
            if not candidate_pair(rep, row):
                continue
            if is_duplicate(rep, row):
                matched_idx = i
                break
        if matched_idx >= 0:
            clusters[matched_idx].append(row)
        else:
            clusters.append([row])
    return clusters


def _default_rule_duplicate_judge(a: Dict[str, Any], b: Dict[str, Any], acrf_context: str | None = None) -> bool:
    return bool(
        llm.judge_step2_rule_duplicate(
            title_a=a["title"],
            requirement_a=a["text"],
            title_b=b["title"],
            requirement_b=b["text"],
            acrf_summary_context=acrf_context,
        )["is_duplicate"]
    )


def _default_deviation_duplicate_judge(
    a: Dict[str, Any], b: Dict[str, Any], acrf_context: str | None = None
) -> bool:
    return bool(
        llm.judge_step2_deviation_duplicate(
            scenario_a=a.get("text", ""),
            example_a=a.get("text", ""),
            scenario_b=b.get("text", ""),
            example_b=b.get("text", ""),
            acrf_summary_context=acrf_context,
        )["is_duplicate"]
    )


def deduplicate_rules(
    *,
    study_id: str,
    rules: List[Dict[str, Any]],
    acrf_context: str | None = None,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    rows = [
        _RuleRow(
            rule_id=str(rule.get("rule_id", "")),
            title=str(rule.get("title", "")),
            text=str(rule.get("text", "")),
            paragraph_refs=list(rule.get("paragraph_refs", [])),
        )
        for rule in rules
    ]
    if not rows:
        return [], []
    clusters = _dedup_rows(
        rows,
        candidate_pair=_candidate_rule_pair,
        is_duplicate=lambda a, b: _default_rule_duplicate_judge(
            {"title": a.title, "text": a.text},
            {"title": b.title, "text": b.text},
            acrf_context,
        ),
    )
    merged: List[Dict[str, Any]] = []
    audit: List[Dict[str, Any]] = []
    for cluster in clusters:
        rep = cluster[0]
        merge_ids = [r.rule_id for r in cluster[1:]]
        refs = sorted({ref for r in cluster for ref in r.paragraph_refs})
        merged.append(
            {
                "rule_id": rep.rule_id,
                "title": rep.title,
                "text": rep.text,
                "paragraph_refs": refs,
            }
        )
        if merge_ids:
            audit.append(
                {
                    "keep_rule_id": rep.rule_id,
                    "merge_rule_ids": merge_ids,
                    "rationale": "semantic duplicate",
                }
            )
    return merged, audit


def deduplicate_deviations(
    *,
    study_id: str,
    deviations: List[Dict[str, Any]],
    normalized_by_id: Dict[str, Dict[str, Any]],
    acrf_context: str | None = None,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    if not deviations:
        return [], []
    enriched = []
    for deviation in deviations:
        norm = normalized_by_id.get(str(deviation.get("deviation_id", "")), {})
        enriched.append({**deviation, **norm})
    clusters = _dedup_rows(
        enriched,
        candidate_pair=_candidate_deviation_pair,
        is_duplicate=lambda a, b: _default_deviation_duplicate_judge(a, b, acrf_context),
    )
    merged: List[Dict[str, Any]] = []
    audit: List[Dict[str, Any]] = []
    for cluster in clusters:
        rep = cluster[0]
        merge_ids = [str(d.get("deviation_id", "")) for d in cluster[1:]]
        out = {k: v for k, v in rep.items() if k not in {"subject", "event", "procedure", "condition", "window"}}
        merged.append(out)
        if merge_ids:
            audit.append(
                {
                    "keep_deviation_id": rep.get("deviation_id", ""),
                    "merge_deviation_ids": merge_ids,
                    "rationale": "semantic duplicate",
                }
            )
    return merged, audit


def deduplicate_checks(
    *,
    study_id: str,
    rules_obj: Dict[str, Any],
    deviations_obj: Dict[str, Any],
    normalized_obj: Dict[str, Any],
    acrf_context: str | None = None,
) -> Tuple[Dict[str, Any], Dict[str, Any], Dict[str, Any]]:
    rules = list(rules_obj.get("rules", []))
    deviations = list(deviations_obj.get("deviations", []))
    normalized_by_id = {
        str(item.get("deviation_id", "")): item for item in normalized_obj.get("items", [])
    }
    merged_rules, rule_audit = deduplicate_rules(study_id=study_id, rules=rules, acrf_context=acrf_context)
    merged_deviations, deviation_audit = deduplicate_deviations(
        study_id=study_id,
        deviations=deviations,
        normalized_by_id=normalized_by_id,
        acrf_context=acrf_context,
    )
    rules_out = {
        "schema_version": rules_obj.get("schema_version", "1.0.0"),
        "study_id": study_id,
        "generated_at": _iso_now(),
        "rules": merged_rules,
    }
    deviations_out = {
        "schema_version": deviations_obj.get("schema_version", "1.0.0"),
        "study_id": study_id,
        "generated_at": _iso_now(),
        "deviations": list(merged_deviations),
    }
    rules_by_id = {r["rule_id"]: r for r in rules_out.get("rules", [])}
    classified_deviations, class_audit = classify_deviations(
        study_id=study_id,
        deviations=deviations_out["deviations"],
        rules_by_id=rules_by_id,
    )
    deviations_out["deviations"] = classified_deviations
    consolidated_deviations, consolidate_audit = consolidate_deviations(
        study_id=study_id,
        deviations=classified_deviations,
    )
    deviations_out["deviations"] = consolidated_deviations
    audit = {
        "schema_version": "1.0.0",
        "study_id": study_id,
        "generated_at": _iso_now(),
        "rule_merges": rule_audit,
        "deviation_merges": deviation_audit,
        "classification_audit": class_audit,
        "consolidation_audit": consolidate_audit,
        "duplicates_removed": len(rule_audit) + len(deviation_audit) + len(consolidate_audit),
    }
    return rules_out, deviations_out, audit

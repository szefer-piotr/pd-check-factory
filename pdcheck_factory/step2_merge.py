"""Step 2 merge: combine Step 1 section outputs with semantic dedup."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone
from difflib import SequenceMatcher
from typing import Any, Callable, Dict, List, Set, Tuple

_TOKEN_RE = re.compile(r"[a-z0-9]+")


@dataclass
class _RuleRow:
    title: str
    atomic_requirement: str
    sentence_refs: List[str]
    source_section_id: str
    source_section_path: List[str]
    candidate_deviations: List[Dict[str, Any]]


@dataclass
class _DeviationRow:
    scenario_description: str
    example_violation_narrative: str
    sentence_refs: List[str]
    source_section_id: str
    source_section_path: List[str]


def _norm_text(s: str) -> str:
    toks = _TOKEN_RE.findall((s or "").lower())
    return " ".join(toks)


def _text_ratio(a: str, b: str) -> float:
    return SequenceMatcher(None, _norm_text(a), _norm_text(b)).ratio()


def _candidate_rule_pair(a: _RuleRow, b: _RuleRow) -> bool:
    if _text_ratio(a.atomic_requirement, b.atomic_requirement) >= 0.62:
        return True
    if _text_ratio(a.title, b.title) >= 0.80:
        return True
    return False


def _candidate_deviation_pair(a: _DeviationRow, b: _DeviationRow) -> bool:
    if _text_ratio(a.scenario_description, b.scenario_description) >= 0.65:
        return True
    if (
        _text_ratio(a.example_violation_narrative, b.example_violation_narrative)
        >= 0.72
    ):
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


def _merge_rule_cluster(cluster: List[_RuleRow]) -> Dict[str, Any]:
    rep = cluster[0]
    refs: Set[str] = set()
    section_ids: Set[str] = set()
    section_paths: List[List[str]] = []
    seen_paths: Set[Tuple[str, ...]] = set()
    deviations: List[_DeviationRow] = []
    for r in cluster:
        refs.update(r.sentence_refs or [])
        section_ids.add(r.source_section_id)
        pkey = tuple(r.source_section_path)
        if pkey not in seen_paths:
            seen_paths.add(pkey)
            section_paths.append(list(r.source_section_path))
        for d in r.candidate_deviations or []:
            deviations.append(
                _DeviationRow(
                    scenario_description=d.get("scenario_description", ""),
                    example_violation_narrative=d.get("example_violation_narrative", ""),
                    sentence_refs=list(d.get("sentence_refs", []) or []),
                    source_section_id=r.source_section_id,
                    source_section_path=list(r.source_section_path),
                )
            )
    return {
        "title": rep.title,
        "atomic_requirement": rep.atomic_requirement,
        "sentence_refs": sorted(refs),
        "source_section_ids": sorted(section_ids),
        "source_section_paths": section_paths,
        "_deviations": deviations,
    }


def _letters(n: int) -> str:
    # 1 -> a, 26 -> z, 27 -> aa
    chars: List[str] = []
    x = n
    while x > 0:
        x -= 1
        chars.append(chr(ord("a") + (x % 26)))
        x //= 26
    return "".join(reversed(chars))


def _default_rule_duplicate_judge(a: Dict[str, Any], b: Dict[str, Any]) -> bool:
    from pdcheck_factory import llm as llm_mod

    return bool(
        llm_mod.judge_step2_rule_duplicate(
            title_a=a["title"],
            requirement_a=a["atomic_requirement"],
            title_b=b["title"],
            requirement_b=b["atomic_requirement"],
        )["is_duplicate"]
    )


def _default_deviation_duplicate_judge(a: Dict[str, Any], b: Dict[str, Any]) -> bool:
    from pdcheck_factory import llm as llm_mod

    return bool(
        llm_mod.judge_step2_deviation_duplicate(
            scenario_a=a["scenario_description"],
            example_a=a["example_violation_narrative"],
            scenario_b=b["scenario_description"],
            example_b=b["example_violation_narrative"],
        )["is_duplicate"]
    )


def merge_step1_outputs(
    *,
    study_id: str,
    step1_objects: List[Dict[str, Any]],
    rule_duplicate_judge: Callable[[Dict[str, Any], Dict[str, Any]], bool] | None = None,
    deviation_duplicate_judge: Callable[[Dict[str, Any], Dict[str, Any]], bool]
    | None = None,
) -> Dict[str, Any]:
    if rule_duplicate_judge is None:
        rule_duplicate_judge = _default_rule_duplicate_judge
    if deviation_duplicate_judge is None:
        deviation_duplicate_judge = _default_deviation_duplicate_judge

    rows: List[_RuleRow] = []
    for obj in step1_objects:
        if obj.get("study_id") != study_id:
            raise ValueError(
                f"Mixed study IDs in Step 1 input: expected {study_id!r}, "
                f"got {obj.get('study_id')!r}."
            )
        section_id = obj.get("section_id", "")
        section_path = list(obj.get("section_path", []) or [])
        for rule in obj.get("rules", []) or []:
            rows.append(
                _RuleRow(
                    title=rule.get("title", ""),
                    atomic_requirement=rule.get("atomic_requirement", ""),
                    sentence_refs=list(rule.get("sentence_refs", []) or []),
                    source_section_id=section_id,
                    source_section_path=section_path,
                    candidate_deviations=list(
                        rule.get("candidate_deviations", []) or []
                    ),
                )
            )

    if not rows:
        return {
            "schema_version": "2.1.0",
            "study_id": study_id,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "rules": [],
        }

    rule_clusters = _dedup_rows(
        rows,
        candidate_pair=_candidate_rule_pair,
        is_duplicate=lambda a, b: rule_duplicate_judge(
            {
                "title": a.title,
                "atomic_requirement": a.atomic_requirement,
            },
            {
                "title": b.title,
                "atomic_requirement": b.atomic_requirement,
            },
        ),
    )
    merged_rules = [_merge_rule_cluster(c) for c in rule_clusters]

    out_rules: List[Dict[str, Any]] = []
    for i, r in enumerate(merged_rules, start=1):
        dev_rows: List[_DeviationRow] = r.pop("_deviations")
        dev_clusters = _dedup_rows(
            dev_rows,
            candidate_pair=_candidate_deviation_pair,
            is_duplicate=lambda a, b: deviation_duplicate_judge(
                {
                    "scenario_description": a.scenario_description,
                    "example_violation_narrative": a.example_violation_narrative,
                },
                {
                    "scenario_description": b.scenario_description,
                    "example_violation_narrative": b.example_violation_narrative,
                },
            ),
        )
        out_devs: List[Dict[str, Any]] = []
        for j, dc in enumerate(dev_clusters, start=1):
            rep = dc[0]
            d_refs: Set[str] = set()
            d_sec_ids: Set[str] = set()
            d_paths: List[List[str]] = []
            seen_dpaths: Set[Tuple[str, ...]] = set()
            for d in dc:
                d_refs.update(d.sentence_refs or [])
                d_sec_ids.add(d.source_section_id)
                pkey = tuple(d.source_section_path)
                if pkey not in seen_dpaths:
                    seen_dpaths.add(pkey)
                    d_paths.append(list(d.source_section_path))
            out_devs.append(
                {
                    "deviation_id": f"dev-{i:03d}{_letters(j)}",
                    "scenario_description": rep.scenario_description,
                    "example_violation_narrative": rep.example_violation_narrative,
                    "sentence_refs": sorted(d_refs),
                    "source_section_ids": sorted(d_sec_ids),
                    "source_section_paths": d_paths,
                }
            )
        out_rules.append(
            {
                "rule_id": f"rule-{i:03d}",
                **r,
                "candidate_deviations": out_devs,
            }
        )

    return {
        "schema_version": "2.1.0",
        "study_id": study_id,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "rules": out_rules,
    }

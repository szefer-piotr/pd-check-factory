"""Per-rule semantic deduplication of deviation candidates."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple

from pdcheck_factory.check_dedup import (
    _candidate_deviation_pair,
    _dedup_rows,
    _default_deviation_duplicate_judge,
)


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


ProgressCallback = Optional[Callable[..., None]]


def deduplicate_deviations_per_rule(
    *,
    study_id: str,
    deviations: List[Dict[str, Any]],
    acrf_context: str | None = None,
    progress_callback: ProgressCallback = None,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Merge semantic duplicates within each rule_id only. Returns (kept, audit)."""
    by_rule: Dict[str, List[Dict[str, Any]]] = {}
    for deviation in deviations:
        rule_id = str(deviation.get("rule_id", "")).strip() or "_unknown"
        by_rule.setdefault(rule_id, []).append(deviation)

    kept: List[Dict[str, Any]] = []
    audit: List[Dict[str, Any]] = []
    rule_ids = sorted(by_rule.keys())
    total_rules = len(rule_ids)

    for index, rule_id in enumerate(rule_ids):
        group = by_rule[rule_id]
        if len(group) <= 1:
            kept.extend(group)
            if progress_callback and total_rules > 0:
                progress_callback(
                    phase="per-rule-dedup",
                    current=index + 1,
                    total=total_rules,
                    unit="rules",
                    label=rule_id,
                )
            continue

        clusters = _dedup_rows(
            group,
            candidate_pair=_candidate_deviation_pair,
            is_duplicate=lambda a, b: _default_deviation_duplicate_judge(a, b, acrf_context),
        )
        for cluster in clusters:
            rep = dict(cluster[0])
            merge_ids = [str(d.get("deviation_id", "")) for d in cluster[1:] if str(d.get("deviation_id", ""))]
            kept.append(rep)
            if merge_ids:
                audit.append(
                    {
                        "rule_id": rule_id,
                        "keep_deviation_id": str(rep.get("deviation_id", "")),
                        "merge_deviation_ids": merge_ids,
                        "rationale": "per-rule semantic duplicate",
                    }
                )

        if progress_callback and total_rules > 0:
            progress_callback(
                phase="per-rule-dedup",
                current=index + 1,
                total=total_rules,
                unit="rules",
                label=rule_id,
            )

    return kept, audit


def build_dedup_audit(
    *,
    study_id: str,
    items: List[Dict[str, Any]],
    before_count: int,
    after_count: int,
) -> Dict[str, Any]:
    return {
        "schema_version": "1.0.0",
        "study_id": study_id,
        "generated_at": _iso_now(),
        "before_count": before_count,
        "after_count": after_count,
        "removed_count": max(0, before_count - after_count),
        "items": items,
    }

"""Consolidate semantically duplicate protocol deviation candidates."""

from __future__ import annotations

import re
from difflib import SequenceMatcher
from typing import Any, Dict, List, Optional, Tuple

from pdcheck_factory import llm
from pdcheck_factory.deviation_contract import pd_spec_field
from pdcheck_factory.prompt_loader import load_prompt

BEGIN_CONSOLIDATE = "<<<BEGIN_CONSOLIDATE>>>"
END_CONSOLIDATE = "<<<END_CONSOLIDATE>>>"
_TOKEN_RE = re.compile(r"[a-z0-9]+")


def _norm_text(value: str) -> str:
    return " ".join(_TOKEN_RE.findall((value or "").lower()))


def _text_ratio(a: str, b: str) -> float:
    return SequenceMatcher(None, _norm_text(a), _norm_text(b)).ratio()


def parse_consolidate_blocks(text: str) -> List[Dict[str, Any]]:
    blocks = []
    for raw in (text or "").split(BEGIN_CONSOLIDATE):
        if END_CONSOLIDATE not in raw:
            continue
        body = raw.split(END_CONSOLIDATE, 1)[0]
        keep_id = ""
        merge_ids: List[str] = []
        revised_text = ""
        rationale = ""
        for line in body.splitlines():
            stripped = line.strip()
            if stripped.startswith("KEEP_DEVIATION_ID:"):
                keep_id = stripped[len("KEEP_DEVIATION_ID:") :].strip()
            elif stripped.startswith("MERGE_DEVIATION_IDS:"):
                rest = stripped[len("MERGE_DEVIATION_IDS:") :].strip()
                merge_ids = [part.strip() for part in rest.split(",") if part.strip()]
            elif stripped.startswith("REVISED_DEVIATION_TEXT:"):
                revised_text = stripped[len("REVISED_DEVIATION_TEXT:") :].strip()
            elif stripped.startswith("RATIONALE:"):
                rationale = stripped[len("RATIONALE:") :].strip()
        if keep_id:
            blocks.append(
                {
                    "keep_deviation_id": keep_id,
                    "merge_deviation_ids": merge_ids,
                    "revised_deviation_text": revised_text,
                    "rationale": rationale,
                }
            )
    return blocks


def _validate_consolidate_reply(text: str) -> Optional[str]:
    if BEGIN_CONSOLIDATE not in text:
        return "Must contain consolidation blocks."
    if not parse_consolidate_blocks(text):
        return "Consolidation blocks must include KEEP_DEVIATION_ID."
    return None


def _cluster_deviations(deviations: List[Dict[str, Any]]) -> List[List[Dict[str, Any]]]:
    clusters: List[List[Dict[str, Any]]] = []
    for deviation in deviations:
        sub = pd_spec_field(deviation, "protocol_deviation_sub_category").strip()
        matched = -1
        for index, cluster in enumerate(clusters):
            rep = cluster[0]
            rep_sub = pd_spec_field(rep, "protocol_deviation_sub_category").strip()
            if sub and rep_sub and sub == rep_sub:
                if _text_ratio(str(rep.get("text", "")), str(deviation.get("text", ""))) >= 0.55:
                    matched = index
                    break
        if matched >= 0:
            clusters[matched].append(deviation)
        else:
            clusters.append([deviation])
    return [cluster for cluster in clusters if len(cluster) > 1]


def _format_cluster(cluster: List[Dict[str, Any]]) -> str:
    lines: List[str] = []
    for deviation in cluster:
        lines.append(
            "\n".join(
                [
                    f"deviation_id: {deviation.get('deviation_id', '')}",
                    f"text: {deviation.get('text', '')}",
                    f"paragraph_refs: {', '.join(deviation.get('paragraph_refs', []))}",
                ]
            )
        )
    return "\n\n---\n\n".join(lines)


def consolidate_deviations(
    *,
    study_id: str,
    deviations: List[Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    by_id = {str(dev.get("deviation_id", "")): dev for dev in deviations}
    remove_ids: set[str] = set()
    audit: List[Dict[str, Any]] = []

    for cluster in _cluster_deviations(deviations):
        reply = llm.chat_text_repairs(
            system=load_prompt("deviation_consolidate_v2_system"),
            user=load_prompt("deviation_consolidate_v2_user").format(
                study_id=study_id,
                cluster_text=_format_cluster(cluster),
            ),
            validate_reply=_validate_consolidate_reply,
            max_repairs=1,
            label=f"v2-consolidate-{cluster[0].get('deviation_id', '')}",
        )
        for block in parse_consolidate_blocks(reply):
            keep_id = str(block.get("keep_deviation_id", ""))
            merge_ids = [str(x) for x in block.get("merge_deviation_ids", [])]
            if not merge_ids:
                audit.append(block)
                continue
            keep = by_id.get(keep_id)
            if not keep:
                audit.append({**block, "applied": False, "reason": "keep_id_not_found"})
                continue
            revised = str(block.get("revised_deviation_text", "")).strip()
            if revised:
                keep["text"] = revised
            for merge_id in merge_ids:
                if merge_id in by_id and merge_id != keep_id:
                    remove_ids.add(merge_id)
            audit.append({**block, "applied": True})

    consolidated = [dev for dev in deviations if str(dev.get("deviation_id", "")) not in remove_ids]
    return consolidated, audit

"""Parse plain-text LLM outputs for Step 1 text pipeline and Step 2 text judges."""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Set, Tuple

BEGIN_RULE = "<<<BEGIN_RULE>>>"
END_RULE = "<<<END_RULE>>>"
BEGIN_DEVIATION = "<<<BEGIN_DEVIATION>>>"
END_DEVIATION = "<<<END_DEVIATION>>>"
BEGIN_DATASET = "<<<BEGIN_DATASET>>>"
END_DATASET = "<<<END_DATASET>>>"
BEGIN_PSEUDO = "<<<BEGIN_PSEUDO>>>"
END_PSEUDO = "<<<END_PSEUDO>>>"
BEGIN_REVISION = "<<<BEGIN_REVISION>>>"
END_REVISION = "<<<END_REVISION>>>"


def _extract_blocks(text: str, begin: str, end: str) -> List[str]:
    out: List[str] = []
    pos = 0
    while True:
        i = text.find(begin, pos)
        if i < 0:
            break
        j = text.find(end, i + len(begin))
        if j < 0:
            out.append(text[i + len(begin) :].strip())
            break
        out.append(text[i + len(begin) : j].strip())
        pos = j + len(end)
    return out


def parse_rule_blocks(text: str) -> List[Dict[str, Any]]:
    """Parse rule blocks into title, atomic_requirement, sentence_refs."""
    blocks = _extract_blocks(text or "", BEGIN_RULE, END_RULE)
    rules: List[Dict[str, Any]] = []
    for raw in blocks:
        title = ""
        requirement = ""
        refs: List[str] = []
        for line in raw.splitlines():
            stripped = line.strip()
            if stripped.startswith("TITLE:"):
                title = stripped[len("TITLE:") :].strip()
            elif stripped.startswith("ATOMIC_REQUIREMENT:"):
                requirement = stripped[len("ATOMIC_REQUIREMENT:") :].strip()
            elif stripped.startswith("SENTENCE_REFS:"):
                rest = stripped[len("SENTENCE_REFS:") :].strip()
                refs = [x.strip() for x in rest.split(",") if x.strip()]
        if title and requirement and refs:
            rules.append(
                {
                    "title": title,
                    "atomic_requirement": requirement,
                    "sentence_refs": refs,
                }
            )
    return rules


def parse_deviation_blocks(text: str) -> List[Dict[str, Any]]:
    """Parse <<<BEGIN_DEVIATION>>> blocks into scenario, example, sentence_refs."""
    blocks = _extract_blocks(text or "", BEGIN_DEVIATION, END_DEVIATION)
    devs: List[Dict[str, Any]] = []
    for raw in blocks:
        scenario = ""
        example = ""
        refs: List[str] = []
        for line in raw.splitlines():
            stripped = line.strip()
            if stripped.startswith("SCENARIO:"):
                scenario = stripped[len("SCENARIO:") :].strip()
            elif stripped.startswith("EXAMPLE:"):
                example = stripped[len("EXAMPLE:") :].strip()
            elif stripped.startswith("SENTENCE_REFS:"):
                rest = stripped[len("SENTENCE_REFS:") :].strip()
                refs = [x.strip() for x in rest.split(",") if x.strip()]
        if scenario and example and refs:
            devs.append(
                {
                    "scenario_description": scenario,
                    "example_violation_narrative": example,
                    "sentence_refs": refs,
                }
            )
    return devs


def parse_revalidated_deviation_blocks(text: str) -> List[Dict[str, Any]]:
    """Parse revalidation blocks including PROGRAMMABLE and PSEUDO_SQL."""
    blocks = _extract_blocks(text or "", BEGIN_DEVIATION, END_DEVIATION)
    devs: List[Dict[str, Any]] = []
    for raw in blocks:
        scenario = ""
        example = ""
        refs: List[str] = []
        programmable: Optional[bool] = None
        pseudo = ""
        for line in raw.splitlines():
            stripped = line.strip()
            if stripped.startswith("SCENARIO:"):
                scenario = stripped[len("SCENARIO:") :].strip()
            elif stripped.startswith("EXAMPLE:"):
                example = stripped[len("EXAMPLE:") :].strip()
            elif stripped.startswith("SENTENCE_REFS:"):
                rest = stripped[len("SENTENCE_REFS:") :].strip()
                refs = [x.strip() for x in rest.split(",") if x.strip()]
            elif stripped.upper().startswith("PROGRAMMABLE:"):
                v = stripped.split(":", 1)[1].strip().lower()
                programmable = v == "yes"
            elif stripped.upper().startswith("PSEUDO_SQL:"):
                pseudo = stripped[len("PSEUDO_SQL:") :].strip()
        if scenario and example and refs and programmable is not None and pseudo:
            devs.append(
                {
                    "scenario_description": scenario,
                    "example_violation_narrative": example,
                    "sentence_refs": refs,
                    "programmable": programmable,
                    "pseudo_sql_logic": pseudo,
                }
            )
    return devs


def parse_programmability(text: str) -> Tuple[bool, str]:
    """Parse PROGRAMMABLE: yes|no and RATIONALE: ..."""
    t = text or ""
    m_prog = re.search(
        r"^PROGRAMMABLE:\s*(yes|no)\s*$",
        t,
        re.MULTILINE | re.IGNORECASE,
    )
    if not m_prog:
        m_prog = re.search(r"PROGRAMMABLE:\s*(yes|no)\b", t, re.IGNORECASE)
    programmable = m_prog and m_prog.group(1).lower() == "yes"
    m_rat = re.search(
        r"RATIONALE:\s*(.+?)(?=^\s*PROGRAMMABLE:|\Z)",
        t,
        re.MULTILINE | re.DOTALL | re.IGNORECASE,
    )
    if not m_rat:
        m_rat = re.search(r"RATIONALE:\s*(.+)", t, re.IGNORECASE | re.DOTALL)
    rationale = (m_rat.group(1).strip() if m_rat else "").strip()
    if not rationale:
        rationale = "(no rationale parsed)"
    return programmable, rationale


_FENCE = re.compile(r"```(?:\w*\n)?(.*?)```", re.DOTALL)


def parse_pseudo_sql_block(text: str) -> str:
    """Extract pseudo-SQL from fenced block or raw text."""
    t = (text or "").strip()
    m = _FENCE.search(t)
    if m:
        return m.group(1).strip()
    if "PSEUDO_SQL" in t.upper():
        # strip label line
        lines = [ln for ln in t.splitlines() if not ln.strip().upper().startswith("PSEUDO_SQL")]
        return "\n".join(lines).strip()
    return t if t else "SELECT 1 WHERE 1=0 -- no pseudo logic generated"


def parse_dedup_judgement(text: str) -> Dict[str, Any]:
    """Parse IS_DUPLICATE, CONFIDENCE, RATIONALE lines."""
    t = text or ""
    dup = False
    m_dup = re.search(r"IS_DUPLICATE:\s*(yes|no)\b", t, re.IGNORECASE)
    if m_dup:
        dup = m_dup.group(1).lower() == "yes"
    conf = 0.5
    m_conf = re.search(r"CONFIDENCE:\s*([0-9]*\.?[0-9]+)", t, re.IGNORECASE)
    if m_conf:
        try:
            conf = float(m_conf.group(1))
            conf = max(0.0, min(1.0, conf))
        except ValueError:
            conf = 0.5
    rat = ""
    m_rat = re.search(r"RATIONALE:\s*(.+)", t, re.IGNORECASE | re.DOTALL)
    if m_rat:
        rat = m_rat.group(1).strip().splitlines()[0][:2000]
    if not rat:
        rat = "No rationale provided."
    return {"is_duplicate": dup, "confidence": conf, "rationale": rat}


def filter_sentence_refs(
    refs: List[str], valid_ids: Set[str]
) -> Tuple[List[str], List[str]]:
    """Return (kept, dropped) sentence refs."""
    kept: List[str] = []
    dropped: List[str] = []
    for r in refs:
        s = (r or "").strip()
        if s in valid_ids:
            kept.append(s)
        else:
            dropped.append(s)
    return kept, dropped


def parse_error_hint(stage: str, detail: str) -> str:
    return f"[{stage}] Parse/validation failed: {detail}\nFix the previous response to match the required format exactly."


def parse_acrf_dataset_blocks(text: str) -> List[Dict[str, Any]]:
    blocks = _extract_blocks(text or "", BEGIN_DATASET, END_DATASET)
    out: List[Dict[str, Any]] = []
    for raw in blocks:
        dataset_name = ""
        columns: List[Dict[str, str]] = []
        current: Dict[str, str] = {}
        for line in raw.splitlines():
            stripped = line.strip()
            if stripped.startswith("DATASET_NAME:"):
                dataset_name = stripped[len("DATASET_NAME:") :].strip()
            elif stripped.startswith("COLUMN_NAME:"):
                if current.get("column_name"):
                    columns.append(current)
                current = {"column_name": stripped[len("COLUMN_NAME:") :].strip()}
            elif stripped.startswith("COLUMN_DESCRIPTION:"):
                current["column_description"] = stripped[len("COLUMN_DESCRIPTION:") :].strip()
            elif stripped.startswith("COLUMN_VALUES:"):
                current["column_values"] = stripped[len("COLUMN_VALUES:") :].strip()
        if current.get("column_name"):
            columns.append(current)
        if dataset_name and columns:
            out.append({"dataset_name": dataset_name, "columns": columns})
    return out


def parse_rules_v2_blocks(text: str) -> List[Dict[str, Any]]:
    blocks = _extract_blocks(text or "", BEGIN_RULE, END_RULE)
    out: List[Dict[str, Any]] = []
    for raw in blocks:
        title = ""
        rule_text = ""
        refs: List[str] = []
        coverage_note = ""
        for line in raw.splitlines():
            stripped = line.strip()
            if stripped.startswith("RULE_TITLE:"):
                title = stripped[len("RULE_TITLE:") :].strip()
            elif stripped.startswith("RULE_TEXT:"):
                rule_text = stripped[len("RULE_TEXT:") :].strip()
            elif stripped.startswith("PARAGRAPH_REFS:"):
                rest = stripped[len("PARAGRAPH_REFS:") :].strip()
                refs = [x.strip() for x in rest.split(",") if x.strip()]
            elif stripped.startswith("COVERAGE_NOTE:"):
                coverage_note = stripped[len("COVERAGE_NOTE:") :].strip()
        if title and rule_text and refs:
            out.append(
                {
                    "title": title,
                    "text": rule_text,
                    "paragraph_refs": refs,
                    "coverage_note": coverage_note,
                }
            )
    return out


def parse_deviations_v2_blocks(text: str) -> List[Dict[str, Any]]:
    blocks = _extract_blocks(text or "", BEGIN_DEVIATION, END_DEVIATION)
    out: List[Dict[str, Any]] = []
    for raw in blocks:
        dev_text = ""
        refs: List[str] = []
        data_note = ""
        for line in raw.splitlines():
            stripped = line.strip()
            if stripped.startswith("DEVIATION_TEXT:"):
                dev_text = stripped[len("DEVIATION_TEXT:") :].strip()
            elif stripped.startswith("PARAGRAPH_REFS:"):
                rest = stripped[len("PARAGRAPH_REFS:") :].strip()
                refs = [x.strip() for x in rest.split(",") if x.strip()]
            elif stripped.startswith("DATA_SUPPORT_NOTE:"):
                data_note = stripped[len("DATA_SUPPORT_NOTE:") :].strip()
        if dev_text and refs:
            out.append(
                {
                    "text": dev_text,
                    "paragraph_refs": refs,
                    "data_support_note": data_note,
                }
            )
    return out


def parse_pseudo_v2_blocks(text: str) -> List[str]:
    blocks = _extract_blocks(text or "", BEGIN_PSEUDO, END_PSEUDO)
    out: List[str] = []
    for raw in blocks:
        pseudo = ""
        for line in raw.splitlines():
            stripped = line.strip()
            if stripped.startswith("PSEUDO_LOGIC:"):
                pseudo = stripped[len("PSEUDO_LOGIC:") :].strip()
        if pseudo:
            out.append(pseudo)
    return out


def parse_revision_block(text: str) -> Optional[Dict[str, Any]]:
    blocks = _extract_blocks(text or "", BEGIN_REVISION, END_REVISION)
    if not blocks:
        return None
    revised = ""
    refs: List[str] = []
    for line in blocks[0].splitlines():
        stripped = line.strip()
        if stripped.startswith("REVISED_TEXT:"):
            revised = stripped[len("REVISED_TEXT:") :].strip()
        elif stripped.startswith("PARAGRAPH_REFS:"):
            rest = stripped[len("PARAGRAPH_REFS:") :].strip()
            refs = [x.strip() for x in rest.split(",") if x.strip()]
    if not revised:
        return None
    return {"revised_text": revised, "paragraph_refs": refs}

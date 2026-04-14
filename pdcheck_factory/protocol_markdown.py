"""Parse protocol Markdown into hierarchical sections with numbered sentence IDs."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

_MANIFEST_SCHEMA_VERSION = "1.1.0"

# Azure Document Intelligence HTML comments in rendered markdown
_DI_PAGE_COMMENT = re.compile(
    r"<!--\s*Page(?:Header|Footer|Number)\s*=\s*[\"'][^\"']*[\"']\s*-->\s*",
    re.IGNORECASE,
)
_DI_PAGEBREAK = re.compile(r"<!--\s*PageBreak\s*-->\s*", re.IGNORECASE)
_EXCESS_NEWLINES = re.compile(r"\n{3,}")

_ATX_HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*$")
# Sentence end followed by whitespace; split conservatively inside text chunks.
_SENT_BOUNDARY = re.compile(r"(?<=[.!?])\s+")
# Lines that are clearly not sentence boundaries when merged (line starts lowercase).
_ABBREV_NO_BREAK = re.compile(
    r"\b(e\.g\.|i\.e\.|vs\.|Dr\.|Mr\.|Mrs\.|Ms\.|Fig\.|et al\.|approx\.|No\.)\s*$",
    re.IGNORECASE,
)

# Rollup disabled: treat as max ATX depth so every heading opens its own section (legacy behavior).
_MAX_ATX_LEVEL = 6


def _short_hash(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()[:12]


def strip_di_page_markers(markdown: str) -> str:
    """Remove repeating DI page metadata comments from full protocol markdown."""
    text = _DI_PAGE_COMMENT.sub("", markdown)
    text = _DI_PAGEBREAK.sub("", text)
    text = _EXCESS_NEWLINES.sub("\n\n", text)
    return text.strip()


def _split_fenced_blocks(text: str) -> List[Tuple[str, str]]:
    """Split into alternating ('text'|'fence', content) segments."""
    out: List[Tuple[str, str]] = []
    i = 0
    n = len(text)
    while i < n:
        if text.startswith("```", i):
            j = text.find("```", i + 3)
            if j < 0:
                out.append(("fence", text[i:]))
                break
            out.append(("fence", text[i : j + 3]))
            i = j + 3
        else:
            j = text.find("```", i)
            if j < 0:
                out.append(("text", text[i:]))
                break
            out.append(("text", text[i:j]))
            i = j
    return out


def _split_text_into_sentences(chunk: str) -> List[str]:
    if not chunk.strip():
        return []
    raw_parts = _SENT_BOUNDARY.split(chunk)
    merged: List[str] = []
    buf = ""
    for part in raw_parts:
        part = part.strip()
        if not part:
            continue
        if not buf:
            buf = part
            continue
        # Rejoin if "new sentence" is actually a continuation (e.g. broken abbreviation).
        if part[0].islower() or _ABBREV_NO_BREAK.search(buf):
            buf = f"{buf} {part}"
        else:
            merged.append(buf.strip())
            buf = part
    if buf:
        merged.append(buf.strip())
    return merged


def split_body_into_sentences(body_markdown: str) -> List[str]:
    """Split section body into sentences; fenced code blocks kept as single units."""
    sentences: List[str] = []
    for kind, seg in _split_fenced_blocks(body_markdown):
        if kind == "fence":
            s = seg.strip()
            if s:
                sentences.append(s)
        else:
            sentences.extend(_split_text_into_sentences(seg))
    return sentences


def _parse_heading_line(line: str) -> Optional[Tuple[int, str]]:
    m = _ATX_HEADING.match(line.rstrip("\n"))
    if not m:
        return None
    level = len(m.group(1))
    title = m.group(2).strip()
    return level, title


def _truncated_path(
    stack: List[Tuple[int, str]], rollup_max_level: int
) -> List[str]:
    path = [t for lv, t in stack if lv <= rollup_max_level]
    if path:
        return path
    if stack:
        return [stack[-1][1]]
    return ["(preamble)"]


def build_sections_manifest(
    markdown: str,
    *,
    study_id: str,
    strip_page_markers: bool = True,
    rollup_max_section_level: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Split markdown on ATX headings (# .. ######). Preamble before the first heading
    is one section with path ["(preamble)"].

    If strip_page_markers is True, remove DI PageHeader/PageFooter/PageNumber/PageBreak
    comments before parsing.

    If rollup_max_section_level is set (1..6), only headings at that depth or shallower
    start a new manifest section; deeper headings are inlined into the parent section body
    as ATX lines. None means legacy behavior (same as rollup_max_section_level=6).
    """
    if rollup_max_section_level is not None and not (
        1 <= rollup_max_section_level <= _MAX_ATX_LEVEL
    ):
        raise ValueError(
            f"rollup_max_section_level must be between 1 and {_MAX_ATX_LEVEL}, "
            f"got {rollup_max_section_level!r}"
        )

    effective_rollup = (
        rollup_max_section_level if rollup_max_section_level is not None else _MAX_ATX_LEVEL
    )

    text = markdown
    stripped = False
    if strip_page_markers:
        text = strip_di_page_markers(text)
        stripped = True

    lines = text.splitlines(keepends=True)
    headings: List[Tuple[int, int, int, str]] = []
    for idx, line in enumerate(lines):
        ph = _parse_heading_line(line)
        if ph:
            level, title = ph
            headings.append((idx, level, len(headings), title))

    sections_raw: List[Dict[str, Any]] = []

    def flush_preamble(end_line: int) -> None:
        body_lines = lines[0:end_line]
        body = "".join(body_lines).strip()
        if not body and sections_raw:
            return
        path = ["(preamble)"]
        sid_seed = study_id + "\n" + "\n".join(path) + "\n0"
        sid = f"sec:{_short_hash(sid_seed)}"
        sections_raw.append(
            {
                "section_id": sid,
                "section_path": path,
                "heading_level": 0,
                "body_markdown": body,
                "_ordinal": 0,
            }
        )

    if not headings:
        flush_preamble(len(lines))
    else:
        if headings[0][0] > 0:
            flush_preamble(headings[0][0])

    stack: List[Tuple[int, str]] = []
    emit_ord = 1
    open_parts: Optional[List[str]] = None
    open_meta: Optional[Tuple[List[str], int]] = None  # (section_path, heading_level)

    def finalize_open() -> None:
        nonlocal open_parts, open_meta, emit_ord
        if open_parts is None or open_meta is None:
            open_parts = None
            open_meta = None
            return
        path, hlevel = open_meta
        body = "".join(open_parts).strip()
        sid_seed = study_id + "\n" + "\n".join(path) + f"\n{emit_ord}"
        sid = f"sec:{_short_hash(sid_seed)}"
        sections_raw.append(
            {
                "section_id": sid,
                "section_path": path,
                "heading_level": hlevel,
                "body_markdown": body,
                "_ordinal": emit_ord,
            }
        )
        emit_ord += 1
        open_parts = None
        open_meta = None

    for hi, (line_idx, level, h_idx, title) in enumerate(headings):
        while stack and stack[-1][0] >= level:
            stack.pop()
        stack.append((level, title))

        next_line = len(lines)
        if hi + 1 < len(headings):
            next_line = headings[hi + 1][0]
        body_chunk = "".join(lines[line_idx + 1 : next_line])

        if level > effective_rollup:
            if open_parts is None:
                # No rollup parent yet — treat like shallow: open synthetic section
                tp = _truncated_path(stack[:-1], effective_rollup) if stack[:-1] else [title]
                open_meta = (tp, stack[0][0] if stack else level)
                open_parts = []
            open_parts.append(f"\n\n{'#' * level} {title}\n")
            open_parts.append(body_chunk)
            continue

        # level <= effective_rollup: start new emitted section
        finalize_open()
        trunc_path = _truncated_path(stack, effective_rollup)
        open_meta = (trunc_path, level)
        open_parts = [body_chunk]

    finalize_open()

    # Legacy path for empty headings already handled; when headings exist but rollup left
    # nothing (should not happen), sections_raw may only have preamble — OK.

    sections_out: List[Dict[str, Any]] = []
    for sec in sections_raw:
        sents = split_body_into_sentences(sec["body_markdown"])
        sid = sec["section_id"]
        sentences = [{"id": f"{sid}#s{i}", "text": t} for i, t in enumerate(sents, start=1)]
        sections_out.append(
            {
                "section_id": sid,
                "section_path": sec["section_path"],
                "heading_level": sec["heading_level"],
                "body_markdown": sec["body_markdown"],
                "sentences": sentences,
            }
        )

    return {
        "manifest_schema_version": _MANIFEST_SCHEMA_VERSION,
        "study_id": study_id,
        "di_page_markers_stripped": stripped,
        "rollup_max_section_level": rollup_max_section_level,
        "sections": sections_out,
    }


def write_manifest(path: Path, data: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def load_manifest(path: Path) -> Dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def get_section_by_id(manifest: Dict[str, Any], section_id: str) -> Optional[Dict[str, Any]]:
    for s in manifest.get("sections", []):
        if s.get("section_id") == section_id:
            return s
    return None


def format_section_for_prompt(section: Dict[str, Any]) -> str:
    """Numbered sentences as sent to the LLM."""
    path_str = " > ".join(section.get("section_path", []))
    lines = [
        f"section_id: {section.get('section_id', '')}",
        f"section_path: {path_str}",
        "",
        "Numbered sentences (cite only these sentence id values):",
    ]
    for s in section.get("sentences", []):
        lines.append(f"{s['id']}: {s['text']}")
    return "\n".join(lines)


def write_numbered_fragment(raw_dir: Path, section: Dict[str, Any]) -> Path:
    raw_dir.mkdir(parents=True, exist_ok=True)
    sid = section["section_id"].replace(":", "_")
    p = raw_dir / f"{sid}.md"
    body = ["# Numbered section", "", format_section_for_prompt(section), ""]
    p.write_text("\n".join(body), encoding="utf-8")
    return p


def validate_step1_output(
    output: Dict[str, Any], manifest_section: Dict[str, Any]
) -> List[str]:
    """Cross-check rules/deviations against manifest sentence ids and rule linkage."""
    errs: List[str] = []
    sid = manifest_section.get("section_id", "")
    if output.get("section_id") != sid:
        errs.append(
            f"Output section_id {output.get('section_id')!r} != manifest {sid!r}."
        )

    valid_ids: Set[str] = {s["id"] for s in manifest_section.get("sentences", [])}
    rules: List[Dict[str, Any]] = output.get("rules", [])

    rule_ids = {r.get("rule_id") for r in rules if r.get("rule_id")}
    if len(rule_ids) != len(rules):
        errs.append("rule_id values must be unique within the section output.")

    for r in rules:
        rid = r.get("rule_id")
        for ref in r.get("sentence_refs", []) or []:
            if ref not in valid_ids:
                errs.append(f"Rule {rid!r} references unknown sentence id {ref!r}.")

    if not rules:
        return errs[:50]

    seen_deviation_ids: Set[str] = set()
    for r in rules:
        rid = r.get("rule_id")
        deviations: List[Dict[str, Any]] = r.get("candidate_deviations", []) or []
        if not deviations:
            errs.append(f"Rule {rid!r} must include at least one candidate_deviation.")
            continue
        for d in deviations:
            did = d.get("deviation_id")
            if did in seen_deviation_ids:
                errs.append(f"deviation_id values must be unique; duplicate {did!r}.")
            elif did:
                seen_deviation_ids.add(did)
            for ref in d.get("sentence_refs", []) or []:
                if ref not in valid_ids:
                    errs.append(
                        f"Deviation {did!r} references unknown sentence id {ref!r}."
                    )

    return errs[:50]


def section_path_matches(section: Dict[str, Any], pattern: re.Pattern[str]) -> bool:
    joined = " / ".join(section.get("section_path", []))
    return bool(pattern.search(joined))


def select_section_ids(
    manifest: Dict[str, Any],
    *,
    all_sections: bool,
    section_ids: List[str],
    match_regex: Optional[str],
    skip_section_ids: List[str],
    skip_regex: Optional[str],
) -> List[str]:
    sections: List[Dict[str, Any]] = manifest.get("sections", [])
    skip_set = set(skip_section_ids)
    pat = re.compile(match_regex) if match_regex else None
    skip_pat = re.compile(skip_regex) if skip_regex else None

    chosen: List[str] = []
    if all_sections:
        chosen = [s["section_id"] for s in sections]
    elif section_ids:
        chosen = list(section_ids)
    elif pat:
        chosen = [s["section_id"] for s in sections if section_path_matches(s, pat)]
    else:
        raise ValueError("Specify --all, --section-id, or --match-regex.")

    if pat:
        chosen = [
            cid
            for cid in chosen
            if (sec := get_section_by_id(manifest, cid)) is not None
            and section_path_matches(sec, pat)
        ]

    out: List[str] = []
    for cid in chosen:
        if cid in skip_set:
            continue
        sec = get_section_by_id(manifest, cid)
        if not sec:
            raise ValueError(f"Unknown section_id: {cid}")
        if skip_pat and section_path_matches(sec, skip_pat):
            continue
        out.append(cid)
    return out

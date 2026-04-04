import argparse
import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

MAX_CHUNK_CHARS = 1200


@dataclass
class MdSection:
    heading: str
    heading_level: int
    line_start: int
    line_end: int
    content: str
    page_start: Optional[int]
    page_end: Optional[int]


def read_json(path: Path) -> Dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def page_from_bounding_regions(item: Dict[str, Any]) -> Tuple[Optional[int], Optional[int]]:
    pages: List[int] = []
    for br in item.get("boundingRegions", []) or []:
        page = br.get("pageNumber")
        if isinstance(page, int):
            pages.append(page)
    if not pages:
        return None, None
    return min(pages), max(pages)


def first_span(item: Dict[str, Any]) -> Tuple[Optional[int], Optional[int]]:
    spans = item.get("spans", []) or []
    if not spans:
        return None, None
    s = spans[0]
    return s.get("offset"), s.get("length")


def parse_markdown_sections(markdown: str) -> Tuple[List[MdSection], Dict[int, int], List[str]]:
    lines = markdown.splitlines()
    heading_re = re.compile(r"^(#{1,6})\s+(.+?)\s*$")
    page_re = re.compile(r'PageNumber="Page\s+(\d+)\s+of\s+\d+"')

    page_by_line: Dict[int, int] = {}
    current_page: Optional[int] = None
    for idx, line in enumerate(lines, start=1):
        m = page_re.search(line)
        if m:
            current_page = int(m.group(1))
        if current_page is not None:
            page_by_line[idx] = current_page

    heading_positions: List[Tuple[int, int, str]] = []
    for idx, line in enumerate(lines, start=1):
        m = heading_re.match(line.strip())
        if m:
            heading_positions.append((idx, len(m.group(1)), m.group(2).strip()))

    sections: List[MdSection] = []
    if not heading_positions:
        text = "\n".join(lines).strip()
        sections.append(
            MdSection(
                heading="Document",
                heading_level=1,
                line_start=1,
                line_end=len(lines),
                content=text,
                page_start=page_by_line.get(1),
                page_end=page_by_line.get(len(lines)),
            )
        )
        return sections, page_by_line, lines

    first_heading_line = heading_positions[0][0]
    if first_heading_line > 1:
        pre_text = "\n".join(lines[: first_heading_line - 1]).strip()
        if pre_text:
            sections.append(
                MdSection(
                    heading="Preamble",
                    heading_level=1,
                    line_start=1,
                    line_end=first_heading_line - 1,
                    content=pre_text,
                    page_start=page_by_line.get(1),
                    page_end=page_by_line.get(first_heading_line - 1),
                )
            )

    for i, (line_no, level, heading) in enumerate(heading_positions):
        end_line = heading_positions[i + 1][0] - 1 if i + 1 < len(heading_positions) else len(lines)
        body = "\n".join(lines[line_no - 1 : end_line]).strip()
        sections.append(
            MdSection(
                heading=heading,
                heading_level=level,
                line_start=line_no,
                line_end=end_line,
                content=body,
                page_start=page_by_line.get(line_no),
                page_end=page_by_line.get(end_line),
            )
        )

    return sections, page_by_line, lines


def derive_document_title(sections_md: List[MdSection], lines: List[str]) -> str:
    for sec in sections_md:
        if sec.heading != "Preamble":
            return sec.heading
    preamble_lines = [ln.strip() for ln in lines[:40] if ln.strip() and not ln.strip().startswith("<!--")]
    return preamble_lines[0] if preamble_lines else "Untitled Document"


def to_table_rows(table: Dict[str, Any]) -> List[List[str]]:
    rows = table.get("rowCount", 0) or 0
    cols = table.get("columnCount", 0) or 0
    matrix = [["" for _ in range(cols)] for _ in range(rows)]
    for cell in table.get("cells", []) or []:
        r = cell.get("rowIndex", 0)
        c = cell.get("columnIndex", 0)
        if 0 <= r < rows and 0 <= c < cols:
            matrix[r][c] = (cell.get("content") or "").strip()
    return matrix


def table_markdown(rows: List[List[str]]) -> str:
    if not rows:
        return ""
    col_count = max(len(r) for r in rows)
    padded = [r + [""] * (col_count - len(r)) for r in rows]
    header = padded[0]
    sep = ["---"] * col_count
    body = padded[1:] if len(padded) > 1 else []

    def fmt(r: List[str]) -> str:
        return "| " + " | ".join(x.replace("\n", " ").strip() for x in r) + " |"

    out = [fmt(header), fmt(sep)]
    out.extend(fmt(r) for r in body)
    return "\n".join(out)


def split_chunk_blocks(text: str, max_chars: int = MAX_CHUNK_CHARS) -> List[str]:
    blocks = [b.strip() for b in re.split(r"\n\s*\n", text) if b.strip()]
    chunks: List[str] = []
    current = ""
    for block in blocks:
        if not current:
            current = block
            continue
        candidate = current + "\n\n" + block
        if len(candidate) <= max_chars:
            current = candidate
            continue
        chunks.append(current)
        if len(block) <= max_chars:
            current = block
            continue
        start = 0
        while start < len(block):
            piece = block[start : start + max_chars].strip()
            if piece:
                chunks.append(piece)
            start += max_chars
        current = ""
    if current:
        chunks.append(current)
    return chunks


def build_section_hierarchy(sections_md: List[MdSection]) -> Tuple[List[Dict[str, Any]], Dict[str, Dict[str, Any]], Dict[int, List[str]]]:
    sections_out: List[Dict[str, Any]] = []
    by_id: Dict[str, Dict[str, Any]] = {}
    by_page: Dict[int, List[str]] = {}
    stack: List[Tuple[int, str, str]] = []  # level, section_id, heading

    for idx, sec in enumerate(sections_md, start=1):
        sec_id = f"sec:{idx:04d}"
        while stack and stack[-1][0] >= sec.heading_level:
            stack.pop()
        parent_id = stack[-1][1] if stack else None
        parent_path_titles = [x[2] for x in stack]
        heading_path = parent_path_titles + [sec.heading]
        stack.append((sec.heading_level, sec_id, sec.heading))
        sec_obj = {
            "id": sec_id,
            "heading": sec.heading,
            "heading_level": sec.heading_level,
            "heading_path": heading_path,
            "heading_path_text": " > ".join(heading_path),
            "parent_section_id": parent_id,
            "children_section_ids": [],
            "order": idx,
            "page_start": sec.page_start,
            "page_end": sec.page_end,
            "line_start": sec.line_start,
            "line_end": sec.line_end,
            "content": sec.content,
            "chunk_ids": [],
            "evidence_reference_ids": [],
        }
        sections_out.append(sec_obj)
        by_id[sec_id] = sec_obj
        if isinstance(parent_id, str):
            by_id[parent_id]["children_section_ids"].append(sec_id)

        if isinstance(sec.page_start, int) and isinstance(sec.page_end, int):
            for p in range(sec.page_start, sec.page_end + 1):
                by_page.setdefault(p, []).append(sec_id)
        elif isinstance(sec.page_start, int):
            by_page.setdefault(sec.page_start, []).append(sec_id)

    return sections_out, by_id, by_page


def section_for_pages(section_ids_by_page: Dict[int, List[str]], page_start: Optional[int], page_end: Optional[int]) -> Optional[str]:
    if not isinstance(page_start, int):
        return None
    candidates = section_ids_by_page.get(page_start, [])
    if candidates:
        return candidates[-1]
    if isinstance(page_end, int):
        candidates = section_ids_by_page.get(page_end, [])
        if candidates:
            return candidates[-1]
    return None


def infer_table_caption(paragraphs: List[Dict[str, Any]], table_page: Optional[int]) -> Optional[str]:
    if not isinstance(table_page, int):
        return None
    candidates: List[str] = []
    for p in paragraphs:
        p_start, p_end = page_from_bounding_regions(p)
        if p_start is None:
            continue
        if p_start in (table_page, table_page - 1) or p_end in (table_page, table_page - 1):
            txt = (p.get("content") or "").strip()
            if txt and len(txt) <= 180 and not txt.startswith("<!--"):
                if re.search(r"(table|schedule|summary|appendix)", txt, flags=re.IGNORECASE):
                    candidates.append(txt)
    return candidates[0] if candidates else None


def detect_footnote_lines(text: str) -> List[Tuple[str, str, float]]:
    found: List[Tuple[str, str, float]] = []
    for line in text.splitlines():
        s = line.strip()
        if not s or s.startswith("<!-- Page"):
            continue
        if re.match(r"^\*+\s+", s):
            found.append((s, "asterisk_marker", 0.6))
        elif re.match(r"^[\u2020\u2021]\s*", s):
            found.append((s, "dagger_marker", 0.65))
        elif re.match(r"^\[\d+\]\s+", s):
            found.append((s, "bracket_numeric_marker", 0.55))
        elif re.match(r"^\d+[\.\)]\s+", s):
            found.append((s, "numeric_marker", 0.45))
        elif re.match(r"^[a-zA-Z][\.\)]\s+", s):
            found.append((s, "letter_marker", 0.4))
    return found


def write_split_outputs(output_path: Path, normalized: Dict[str, Any]) -> None:
    base = output_path.parent
    (base / "sections.json").write_text(json.dumps(normalized["sections"], ensure_ascii=False, indent=2), encoding="utf-8")
    (base / "tables.json").write_text(json.dumps(normalized["tables"], ensure_ascii=False, indent=2), encoding="utf-8")
    (base / "footnote_candidates.json").write_text(
        json.dumps(normalized["footnote_candidates"], ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (base / "chunks.json").write_text(json.dumps(normalized["chunks"], ensure_ascii=False, indent=2), encoding="utf-8")


def normalize(*, study_id: str, analyze_result_path: Path, markdown_path: Path, output_path: Path) -> Dict[str, Any]:
    analyze = read_json(analyze_result_path)
    markdown = read_text(markdown_path)
    paragraphs = analyze.get("paragraphs", []) or []
    tables = analyze.get("tables", []) or []
    sections_md, _, lines = parse_markdown_sections(markdown)
    document_title = derive_document_title(sections_md, lines)

    normalized_sections, section_by_id, section_ids_by_page = build_section_hierarchy(sections_md)
    evidence_references: List[Dict[str, Any]] = []
    paragraph_ev_ids_by_page: Dict[int, List[str]] = {}
    table_ev_ids_by_page: Dict[int, List[str]] = {}
    cell_ev_ids_by_table: Dict[str, List[str]] = {}

    for idx, p in enumerate(paragraphs):
        ev_id = f"ev:p:{idx + 1:06d}"
        p_start, p_end = page_from_bounding_regions(p)
        span_offset, span_length = first_span(p)
        ref = {
            "id": ev_id,
            "source_type": "paragraph",
            "source_id": f"paragraph:{idx}",
            "page": p_start,
            "page_end": p_end,
            "span_offset": span_offset,
            "span_length": span_length,
            "quote": (p.get("content") or "")[:500],
            "bounding_regions": p.get("boundingRegions", []),
        }
        evidence_references.append(ref)
        if isinstance(p_start, int):
            paragraph_ev_ids_by_page.setdefault(p_start, []).append(ev_id)

    normalized_tables: List[Dict[str, Any]] = []
    for idx, t in enumerate(tables):
        tbl_id = f"tbl:{idx + 1:04d}"
        t_start, t_end = page_from_bounding_regions(t)
        rows = to_table_rows(t)
        raw_md = table_markdown(rows)
        related_section_id = section_for_pages(section_ids_by_page, t_start, t_end)
        caption = infer_table_caption(paragraphs, t_start)

        t_ev_id = f"ev:t:{idx + 1:06d}"
        evidence_references.append(
            {
                "id": t_ev_id,
                "source_type": "table",
                "source_id": f"table:{idx}",
                "page": t_start,
                "page_end": t_end,
                "span_offset": first_span(t)[0],
                "span_length": first_span(t)[1],
                "quote": raw_md[:500],
                "bounding_regions": t.get("boundingRegions", []),
            }
        )
        if isinstance(t_start, int):
            table_ev_ids_by_page.setdefault(t_start, []).append(t_ev_id)

        cell_ev_ids: List[str] = []
        for cell_idx, c in enumerate(t.get("cells", []) or []):
            if not (c.get("content") or "").strip():
                continue
            cell_ev_id = f"ev:tc:{idx + 1:04d}{cell_idx + 1:05d}"
            c_start, c_end = page_from_bounding_regions(c)
            c_span_offset, c_span_length = first_span(c)
            evidence_references.append(
                {
                    "id": cell_ev_id,
                    "source_type": "table_cell",
                    "source_id": f"table:{idx}/cell:r{c.get('rowIndex', 0)}c{c.get('columnIndex', 0)}",
                    "page": c_start if c_start is not None else t_start,
                    "page_end": c_end if c_end is not None else t_end,
                    "span_offset": c_span_offset,
                    "span_length": c_span_length,
                    "quote": (c.get("content") or "")[:250],
                    "bounding_regions": c.get("boundingRegions", []),
                }
            )
            cell_ev_ids.append(cell_ev_id)

        cell_ev_ids_by_table[tbl_id] = cell_ev_ids

        is_continued = False
        continuation_notes = ""
        if idx + 1 < len(tables):
            nxt = tables[idx + 1]
            n_start, _ = page_from_bounding_regions(nxt)
            if (
                isinstance(t_start, int)
                and isinstance(n_start, int)
                and n_start in (t_start, t_start + 1)
                and nxt.get("columnCount") == t.get("columnCount")
            ):
                is_continued = True
                continuation_notes = "Likely continuation on adjacent page with same column count."

        normalized_tables.append(
            {
                "id": tbl_id,
                "order": idx + 1,
                "page_start": t_start,
                "page_end": t_end,
                "related_section_id": related_section_id,
                "row_count": t.get("rowCount"),
                "column_count": t.get("columnCount"),
                "header_rows": [0] if rows else [],
                "rows": rows,
                "raw_markdown": raw_md,
                "raw_di_table": t,
                "caption": caption,
                "is_continued": is_continued,
                "continuation_notes": continuation_notes,
                "evidence_reference_ids": [t_ev_id] + cell_ev_ids[:40],
            }
        )

    footnote_candidates: List[Dict[str, Any]] = []
    normalized_chunks: List[Dict[str, Any]] = []
    chunk_counter = 0
    fn_counter = 0

    for sec in normalized_sections:
        sec_pages = []
        if isinstance(sec["page_start"], int) and isinstance(sec["page_end"], int):
            sec_pages = list(range(sec["page_start"], sec["page_end"] + 1))
        elif isinstance(sec["page_start"], int):
            sec_pages = [sec["page_start"]]

        section_evs: List[str] = []
        table_ids_in_section: List[str] = []
        for p in sec_pages:
            section_evs.extend(paragraph_ev_ids_by_page.get(p, []))
            section_evs.extend(table_ev_ids_by_page.get(p, []))
            for t in normalized_tables:
                if t["page_start"] == p or t["page_end"] == p:
                    table_ids_in_section.append(t["id"])
        seen = set()
        section_evs = [x for x in section_evs if not (x in seen or seen.add(x))]
        seen = set()
        table_ids_in_section = [x for x in table_ids_in_section if not (x in seen or seen.add(x))]
        sec["evidence_reference_ids"] = section_evs[:120]

        text_blocks = split_chunk_blocks(sec["content"])
        for i, block in enumerate(text_blocks, start=1):
            chunk_counter += 1
            chk_id = f"chk:{chunk_counter:05d}"
            sec["chunk_ids"].append(chk_id)

            block_lower = block.lower()
            chunk_type = "section_chunk"
            related_table_id = None
            if "<table>" in block_lower or "| ---" in block_lower:
                chunk_type = "table_chunk"
                related_table_id = table_ids_in_section[0] if table_ids_in_section else None

            footnote_ids: List[str] = []
            for foot_text, reason, confidence in detect_footnote_lines(block):
                fn_counter += 1
                fn_id = f"fn:{fn_counter:05d}"
                footnote_ids.append(fn_id)
                if related_table_id:
                    confidence = min(0.9, confidence + 0.1)
                footnote_candidates.append(
                    {
                        "id": fn_id,
                        "text": foot_text[:500],
                        "page": sec["page_start"],
                        "nearest_section_id": sec["id"],
                        "nearest_table_id": related_table_id,
                        "nearest_chunk_id": chk_id,
                        "reason": reason + ("_near_table" if related_table_id else ""),
                        "confidence": confidence,
                        "evidence_reference_ids": section_evs[:8],
                    }
                )

            if footnote_ids and chunk_type == "section_chunk":
                chunk_type = "footnote_chunk"
            elif footnote_ids and chunk_type == "table_chunk":
                chunk_type = "composite_chunk"

            source_refs = section_evs[:30]
            if related_table_id:
                source_refs.extend(cell_ev_ids_by_table.get(related_table_id, [])[:15])
                source_refs = list(dict.fromkeys(source_refs))

            normalized_chunks.append(
                {
                    "id": chk_id,
                    "chunk_type": chunk_type,
                    "document_id": f"doc:{study_id}",
                    "related_section_id": sec["id"],
                    "related_table_id": related_table_id,
                    "heading_path": sec["heading_path"],
                    "heading_path_text": sec["heading_path_text"],
                    "page_start": sec["page_start"],
                    "page_end": sec["page_end"],
                    "content": block,
                    "source_references": source_refs,
                    "footnote_candidate_ids": footnote_ids,
                    "char_count": len(block),
                    "token_estimate": max(1, len(block) // 4),
                }
            )

    for t in normalized_tables:
        chunk_counter += 1
        chunk_id = f"chk:{chunk_counter:05d}"
        sec = section_by_id.get(t["related_section_id"]) if t["related_section_id"] else None
        normalized_chunks.append(
            {
                "id": chunk_id,
                "chunk_type": "table_chunk",
                "document_id": f"doc:{study_id}",
                "related_section_id": t["related_section_id"],
                "related_table_id": t["id"],
                "heading_path": sec["heading_path"] if sec else [],
                "heading_path_text": sec["heading_path_text"] if sec else "",
                "page_start": t["page_start"],
                "page_end": t["page_end"],
                "content": t["raw_markdown"],
                "source_references": t["evidence_reference_ids"][:40],
                "footnote_candidate_ids": [],
                "char_count": len(t["raw_markdown"]),
                "token_estimate": max(1, len(t["raw_markdown"]) // 4),
            }
        )
        if sec:
            sec["chunk_ids"].append(chunk_id)

    document = {
        "id": f"doc:{study_id}",
        "study_id": study_id,
        "title": document_title,
        "source": {"analyze_result_path": str(analyze_result_path), "markdown_path": str(markdown_path)},
        "model": {"model_id": analyze.get("modelId"), "api_version": analyze.get("apiVersion")},
        "stats": {
            "page_count": len(analyze.get("pages", []) or []),
            "paragraph_count": len(paragraphs),
            "table_count": len(normalized_tables),
            "section_count": len(normalized_sections),
            "chunk_count": len(normalized_chunks),
        },
        "content_hash_sha256": hashlib.sha256(markdown.encode("utf-8")).hexdigest(),
        "section_ids": [s["id"] for s in normalized_sections],
        "table_ids": [t["id"] for t in normalized_tables],
        "chunk_ids": [c["id"] for c in normalized_chunks],
    }

    normalized = {
        "document": document,
        "sections": normalized_sections,
        "tables": normalized_tables,
        "chunks": normalized_chunks,
        "footnote_candidates": footnote_candidates,
        "evidence_references": evidence_references,
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(normalized, ensure_ascii=False, indent=2), encoding="utf-8")
    write_split_outputs(output_path, normalized)
    return normalized


def main() -> None:
    parser = argparse.ArgumentParser(description="Normalize DI Layout outputs for LLM context.")
    parser.add_argument("--study-id", required=True, help="Study id for document identity.")
    parser.add_argument("--analyze-json", required=True, help="Path to DI analyze_result.json")
    parser.add_argument("--markdown", required=True, help="Path to DI markdown output (protocol_v1.md)")
    parser.add_argument("--output", required=True, help="Path to normalized output JSON file.")
    args = parser.parse_args()

    normalized = normalize(
        study_id=args.study_id,
        analyze_result_path=Path(args.analyze_json),
        markdown_path=Path(args.markdown),
        output_path=Path(args.output),
    )
    stats = normalized["document"]["stats"]
    print("Normalization complete.")
    print(f"sections={stats['section_count']}, tables={stats['table_count']}, chunks={stats['chunk_count']}")
    print(f"output={args.output}")


if __name__ == "__main__":
    main()


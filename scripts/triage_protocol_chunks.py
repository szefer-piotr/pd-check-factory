import argparse
import csv
import json
from pathlib import Path
from typing import Any, Dict, List, Set


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def has_any(text: str, terms: List[str]) -> bool:
    t = (text or "").lower()
    return any(term.lower() in t for term in terms)


def score_chunk(chunk: Dict[str, Any], rules: Dict[str, Any]) -> Dict[str, Any]:
    weights = rules["score_weights"]
    heading = chunk.get("heading_path_text", "")
    content = chunk.get("content", "")
    chunk_type = chunk.get("chunk_type", "")
    reasons: List[str] = []
    score = 0

    if has_any(heading, rules["heading_include_keywords"]):
        score += weights["heading_include"]
        reasons.append("heading_include_keyword")

    if chunk_type in ("table_chunk", "composite_chunk"):
        score += weights["table_or_composite_chunk"]
        reasons.append("table_or_composite_chunk")

    if has_any(content, rules["content_timing_keywords"]):
        score += weights["timing_content"]
        reasons.append("timing_content_keyword")

    if has_any(content, rules["content_mandatory_keywords"]):
        score += weights["mandatory_content"]
        reasons.append("mandatory_content_keyword")

    if has_any(heading, rules["heading_deprioritize_keywords"]):
        score += weights["heading_deprioritize"]
        reasons.append("heading_deprioritize_keyword")

    thresholds = rules["thresholds"]
    if score >= thresholds["high_priority_min"]:
        label = "high_priority"
    elif score >= thresholds["medium_priority_min"]:
        label = "medium_priority"
    else:
        label = "ignore_for_now"

    return {"triage_score": score, "triage_label": label, "triage_reasons": reasons}


def build_candidate_set(
    sections: List[Dict[str, Any]],
    chunks: List[Dict[str, Any]],
    tables: List[Dict[str, Any]],
    rules: Dict[str, Any],
) -> List[Dict[str, Any]]:
    by_chunk_id = {c["id"]: c for c in chunks}
    by_page_chunks: Dict[int, List[str]] = {}
    for c in chunks:
        ps = c.get("page_start")
        pe = c.get("page_end")
        if isinstance(ps, int) and isinstance(pe, int):
            for p in range(ps, pe + 1):
                by_page_chunks.setdefault(p, []).append(c["id"])
        elif isinstance(ps, int):
            by_page_chunks.setdefault(ps, []).append(c["id"])

    candidate_ids: Set[str] = set()
    seed_section_ids = set(rules.get("high_signal_section_ids", []))

    for s in sections:
        is_seed = s["id"] in seed_section_ids
        is_heading_match = has_any(s.get("heading_path_text", ""), rules["heading_include_keywords"])
        if not (is_seed or is_heading_match):
            continue

        for cid in s.get("chunk_ids", []):
            if cid in by_chunk_id:
                candidate_ids.add(cid)

        p_start = s.get("page_start")
        p_end = s.get("page_end")
        if isinstance(p_start, int) and isinstance(p_end, int):
            for p in range(p_start, p_end + 1):
                for cid in by_page_chunks.get(p, []):
                    c = by_chunk_id[cid]
                    if c.get("chunk_type") in ("table_chunk", "composite_chunk"):
                        candidate_ids.add(cid)
        elif isinstance(p_start, int):
            for cid in by_page_chunks.get(p_start, []):
                c = by_chunk_id[cid]
                if c.get("chunk_type") in ("table_chunk", "composite_chunk"):
                    candidate_ids.add(cid)

    # Extra recall: capture chunks with strong timing/mandatory terms
    all_signal_terms = list(
        dict.fromkeys(
            rules["content_timing_keywords"]
            + rules["content_mandatory_keywords"]
            + ["visit window", "pre-dose", "post-dose", "treatment compliance", "interrupt"]
        )
    )
    for c in chunks:
        if has_any(c.get("content", ""), all_signal_terms):
            candidate_ids.add(c["id"])

    # Extra recall: include procedural table chunks anywhere they contain hints
    hint_terms = rules.get("procedural_table_hint_keywords", [])
    for c in chunks:
        if c.get("chunk_type") in ("table_chunk", "composite_chunk") and has_any(c.get("content", ""), hint_terms):
            candidate_ids.add(c["id"])

    candidates = [by_chunk_id[cid] for cid in sorted(candidate_ids)]
    return candidates


def curate_llm_input(triaged: List[Dict[str, Any]], rules: Dict[str, Any]) -> List[Dict[str, Any]]:
    highs = [c for c in triaged if c["triage_label"] == "high_priority"]
    mediums = [c for c in triaged if c["triage_label"] == "medium_priority"]
    high_pages = set()
    high_heading_paths = set()
    for h in highs:
        ps = h.get("page_start")
        pe = h.get("page_end")
        if isinstance(ps, int):
            high_pages.add(ps)
            high_pages.add(ps - 1)
            high_pages.add(ps + 1)
        if isinstance(pe, int):
            high_pages.add(pe)
            high_pages.add(pe - 1)
            high_pages.add(pe + 1)
        high_heading_paths.add(h.get("heading_path_text", ""))

    curated = list(highs)
    for m in mediums:
        include = False
        if rules["curation"].get("include_medium_if_adjacent_page_to_high", True):
            ps = m.get("page_start")
            pe = m.get("page_end")
            if (isinstance(ps, int) and ps in high_pages) or (isinstance(pe, int) and pe in high_pages):
                include = True
        if not include and rules["curation"].get("include_medium_if_same_heading_path_as_high", True):
            if m.get("heading_path_text", "") in high_heading_paths:
                include = True
        if include:
            curated.append(m)

    # Deduplicate preserving order
    seen: Set[str] = set()
    out: List[Dict[str, Any]] = []
    for c in curated:
        cid = c["id"]
        if cid in seen:
            continue
        seen.add(cid)
        out.append(c)
    return out


def add_feedback_template(output_dir: Path) -> None:
    template = {
        "instructions": [
            "Review 20-30 triaged chunks for this protocol.",
            "Mark false positives and false negatives.",
            "Add rule adjustments and keep monthly version notes."
        ],
        "triage_version": "v1",
        "review_samples": [],
        "false_positives": [],
        "false_negatives": [],
        "rule_adjustments": [],
        "notes": ""
    }
    write_json(output_dir / "triage_feedback_template.json", template)


def export_curated_csv(path: Path, curated: List[Dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "chunk_id",
        "chunk_type",
        "heading_path_text",
        "page_start",
        "page_end",
        "related_section_id",
        "related_table_id",
        "triage_label",
        "triage_score",
        "triage_reasons",
        "source_references",
        "content",
    ]
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for c in curated:
            writer.writerow(
                {
                    "chunk_id": c.get("id"),
                    "chunk_type": c.get("chunk_type"),
                    "heading_path_text": c.get("heading_path_text"),
                    "page_start": c.get("page_start"),
                    "page_end": c.get("page_end"),
                    "related_section_id": c.get("related_section_id"),
                    "related_table_id": c.get("related_table_id"),
                    "triage_label": c.get("triage_label"),
                    "triage_score": c.get("triage_score"),
                    "triage_reasons": "|".join(c.get("triage_reasons", [])),
                    "source_references": "|".join(c.get("source_references", [])),
                    "content": c.get("content", "").replace("\n", " ").strip(),
                }
            )


def main() -> None:
    parser = argparse.ArgumentParser(description="Prioritize protocol chunks for LLM extraction.")
    parser.add_argument("--study-id", required=True, help="Study id, e.g. TEST")
    parser.add_argument(
        "--normalized-dir",
        default=None,
        help="Directory containing sections.json/chunks.json/tables.json. Defaults to output/<study-id>/layout/normalized",
    )
    parser.add_argument(
        "--rules",
        default="config/triage_rules.json",
        help="Path to triage rule config JSON",
    )
    parser.add_argument(
        "--export-shortlist-csv",
        nargs="?",
        const="__DEFAULT__",
        default=None,
        help=(
            "Optional CSV export path for curated shortlist. "
            "If provided without a value, defaults to "
            "output/<study-id>/layout/triage/llm_input_curated.csv."
        ),
    )
    args = parser.parse_args()

    normalized_dir = (
        Path(args.normalized_dir)
        if args.normalized_dir
        else Path("output") / args.study_id / "layout" / "normalized"
    )
    rules_path = Path(args.rules)

    sections = read_json(normalized_dir / "sections.json")
    chunks = read_json(normalized_dir / "chunks.json")
    tables = read_json(normalized_dir / "tables.json")
    rules = read_json(rules_path)

    candidates = build_candidate_set(sections, chunks, tables, rules)
    triaged: List[Dict[str, Any]] = []
    for c in candidates:
        triage = score_chunk(c, rules)
        triaged.append(
            {
                "id": c["id"],
                "chunk_type": c.get("chunk_type"),
                "heading_path_text": c.get("heading_path_text"),
                "page_start": c.get("page_start"),
                "page_end": c.get("page_end"),
                "content": c.get("content"),
                "related_section_id": c.get("related_section_id"),
                "related_table_id": c.get("related_table_id"),
                "source_references": c.get("source_references", []),
                "triage_label": triage["triage_label"],
                "triage_score": triage["triage_score"],
                "triage_reasons": triage["triage_reasons"],
            }
        )

    curated = curate_llm_input(triaged, rules)

    output_dir = Path("output") / args.study_id / "layout" / "triage"
    write_json(output_dir / "candidate_chunks.json", candidates)
    write_json(output_dir / "triaged_chunks.json", triaged)
    write_json(output_dir / "llm_input_curated.json", curated)
    add_feedback_template(output_dir)

    csv_path = None
    if args.export_shortlist_csv is not None:
        if args.export_shortlist_csv == "__DEFAULT__":
            csv_path = output_dir / "llm_input_curated.csv"
        else:
            csv_path = Path(args.export_shortlist_csv)
    if csv_path is not None:
        export_curated_csv(csv_path, curated)

    label_counts: Dict[str, int] = {"high_priority": 0, "medium_priority": 0, "ignore_for_now": 0}
    for t in triaged:
        label_counts[t["triage_label"]] = label_counts.get(t["triage_label"], 0) + 1

    print("Triage complete.")
    print(f"candidate_chunks={len(candidates)}")
    print(f"triaged_label_counts={label_counts}")
    print(f"curated_chunks={len(curated)}")
    print(f"output_dir={output_dir}")
    if csv_path is not None:
        print(f"curated_csv={csv_path}")


if __name__ == "__main__":
    main()


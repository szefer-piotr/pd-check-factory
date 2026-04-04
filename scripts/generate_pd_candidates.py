import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List


SCHEMA_VERSION = "1.0.0"


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def guess_category(heading: str, content: str) -> str:
    h = (heading or "").lower()
    c = (content or "").lower()
    if "inclusion" in h or "exclusion" in h:
        return "eligibility_operational"
    if "compliance" in h:
        return "treatment_compliance"
    if "dose" in h or "post-dose" in c or "pre-dose" in c:
        return "dose_timing"
    if "window" in h or "visit" in h:
        return "visit_window"
    if "assessment" in h or "procedure" in h:
        return "assessment_timing"
    if "missed" in c or "not performed" in c:
        return "procedure_missed"
    return "other"


def extract_window(content: str) -> Dict[str, Any]:
    text = content or ""
    m = re.search(r"(\+/-\s*\d+)\s*(day|days|week|weeks|hour|hours|minute|minutes)", text, re.IGNORECASE)
    if m:
        num = int(re.sub(r"\D", "", m.group(1)))
        unit_raw = m.group(2).lower()
        unit = "days"
        if "week" in unit_raw:
            unit = "weeks"
        elif "hour" in unit_raw:
            unit = "hours"
        elif "minute" in unit_raw:
            unit = "minutes"
        return {
            "window_text": m.group(0),
            "window_type": "plus_minus",
            "lower_bound": -num,
            "upper_bound": num,
            "unit": unit,
        }
    return {
        "window_text": "No explicit numeric window identified in this chunk.",
        "window_type": "unspecified",
        "lower_bound": None,
        "upper_bound": None,
        "unit": None,
    }


def extract_timing_anchor(heading: str, content: str) -> Dict[str, Any]:
    h = (heading or "").lower()
    c = (content or "").lower()
    if "visit" in h or "visit" in c:
        return {"anchor_type": "visit", "anchor_description": heading or "Visit-based anchor"}
    if "dose" in h or "pre-dose" in c or "post-dose" in c:
        return {"anchor_type": "dose", "anchor_description": "Dose administration timing"}
    if "screening" in h:
        return {"anchor_type": "screening", "anchor_description": "Screening phase"}
    if "baseline" in h:
        return {"anchor_type": "baseline", "anchor_description": "Baseline assessment"}
    if "procedure" in h:
        return {"anchor_type": "procedure", "anchor_description": "Procedure execution timing"}
    return {"anchor_type": "unspecified", "anchor_description": "Anchor needs reviewer clarification"}


def confidence_from_triage(label: str, score: float) -> float:
    if label == "high_priority":
        return min(0.95, 0.65 + (score * 0.03))
    if label == "medium_priority":
        return min(0.8, 0.45 + (score * 0.02))
    return 0.35


def build_candidate(chunk: Dict[str, Any], idx: int) -> Dict[str, Any]:
    heading = chunk.get("heading_path_text", "")
    content = chunk.get("content", "")
    category = guess_category(heading, content)
    window = extract_window(content)
    anchor = extract_timing_anchor(heading, content)
    triage_label = chunk.get("triage_label", "medium_priority")
    triage_score = float(chunk.get("triage_score", 0))
    conf = confidence_from_triage(triage_label, triage_score)

    quote = " ".join((content or "").split())[:280]
    title = heading.split(">")[-1].strip() if heading else "Protocol deviation candidate"
    if len(title) < 4:
        title = "Protocol deviation candidate"

    ambiguity = window["window_type"] == "unspecified" or category == "other"

    return {
        "candidate_id": f"cand:{idx:05d}",
        "deviation_title": f"{title} deviation candidate",
        "deviation_category": category,
        "protocol_rule_description": f"Rule inferred from section: {heading}",
        "candidate_trigger_condition": "Condition likely violated when observed data conflicts with the protocol rule text.",
        "timing_anchor": anchor,
        "allowed_window": window,
        "exceptions_notes": "Auto-generated draft. Confirm protocol exceptions during review.",
        "source_evidence": [
            {
                "chunk_id": chunk.get("id", ""),
                "quote": quote if quote else "No quote extracted.",
                "source_references": chunk.get("source_references", [])[:12],
            }
        ],
        "confidence": round(conf, 3),
        "ambiguity_flag": ambiguity,
        "reviewer_notes": "",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Stage A: generate draft PD candidates from curated chunks.")
    parser.add_argument("--study-id", required=True)
    parser.add_argument(
        "--curated-chunks",
        default=None,
        help="Path to llm_input_curated.json. Defaults to output/<study-id>/layout/triage/llm_input_curated.json",
    )
    parser.add_argument(
        "--output",
        default=None,
        help="Output candidates path. Defaults to output/<study-id>/pd/candidates.json",
    )
    args = parser.parse_args()

    curated_path = (
        Path(args.curated_chunks)
        if args.curated_chunks
        else Path("output") / args.study_id / "layout" / "triage" / "llm_input_curated.json"
    )
    output_path = (
        Path(args.output)
        if args.output
        else Path("output") / args.study_id / "pd" / "candidates.json"
    )

    chunks = read_json(curated_path)
    candidates: List[Dict[str, Any]] = []
    for idx, chunk in enumerate(chunks, start=1):
        candidates.append(build_candidate(chunk, idx))

    out = {
        "schema_version": SCHEMA_VERSION,
        "study_id": args.study_id,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "candidates": candidates,
    }
    write_json(output_path, out)

    print("Stage A complete.")
    print(f"curated_chunks={len(chunks)}")
    print(f"candidates={len(candidates)}")
    print(f"output={output_path}")


if __name__ == "__main__":
    main()


import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List


SCHEMA_VERSION = "1.0.0"


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def domain_hints_for_category(category: str) -> List[str]:
    mapping = {
        "visit_window": ["visit_dates", "visit_schedule", "subject_id"],
        "procedure_missed": ["procedure_performed_flag", "visit_dates", "subject_id"],
        "assessment_timing": ["assessment_datetime", "visit_dates", "subject_id"],
        "dose_timing": ["dose_datetime", "dosing_records", "subject_id"],
        "eligibility_operational": ["screening_labs", "eligibility_flags", "subject_id"],
        "treatment_compliance": ["drug_accountability", "dose_log", "subject_id"],
        "other": ["subject_id", "review_required"],
    }
    return mapping.get(category, mapping["other"])


def build_logic(candidate: Dict[str, Any]) -> Dict[str, Any]:
    category = candidate.get("deviation_category", "other")
    hints = domain_hints_for_category(category)
    trigger_text = candidate.get("candidate_trigger_condition", "")
    window = candidate.get("allowed_window", {})
    window_text = window.get("window_text", "unspecified")
    anchor = candidate.get("timing_anchor", {}).get("anchor_description", "unspecified anchor")

    logic = (
        f"Join subject records with anchor event ({anchor}); evaluate whether observed event timing "
        f"satisfies protocol rule; flag deviation when condition indicates violation: {trigger_text}"
    )

    return {
        "candidate_id": candidate["candidate_id"],
        "required_source_data_domain_hints": hints,
        "computable_trigger_expression_draft": logic,
        "timing_evaluation_method": f"Anchor observed events to {anchor} and compare actual timestamps.",
        "window_evaluation_method": f"Parse window from protocol text ('{window_text}') and evaluate boundary compliance.",
        "exception_handling_logic": "Exclude records with documented protocol-approved exceptions; otherwise keep flagged.",
        "assumptions": [
            "Event datetimes are available and timezone-consistent.",
            "Protocol windows are interpreted in calendar units unless specified otherwise."
        ],
        "data_quality_risks": [
            "Missing or partial timestamps may produce false positives.",
            "Unstructured notes may contain undocumented exceptions."
        ],
        "confidence": round(float(candidate.get("confidence", 0.5)) * 0.9, 3),
        "ambiguity_flag": bool(candidate.get("ambiguity_flag", False)),
        "reviewer_notes": "",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Stage B: generate draft PD logic from candidates.")
    parser.add_argument("--study-id", required=True)
    parser.add_argument(
        "--candidates",
        default=None,
        help="Path to candidates.json. Defaults to output/<study-id>/pd/candidates.json",
    )
    parser.add_argument(
        "--output",
        default=None,
        help="Output logic path. Defaults to output/<study-id>/pd/logic_drafts.json",
    )
    args = parser.parse_args()

    candidates_path = (
        Path(args.candidates)
        if args.candidates
        else Path("output") / args.study_id / "pd" / "candidates.json"
    )
    output_path = (
        Path(args.output)
        if args.output
        else Path("output") / args.study_id / "pd" / "logic_drafts.json"
    )

    data = read_json(candidates_path)
    candidates = data.get("candidates", [])
    logic_drafts = [build_logic(c) for c in candidates]

    out = {
        "schema_version": SCHEMA_VERSION,
        "study_id": args.study_id,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "logic_drafts": logic_drafts,
    }
    write_json(output_path, out)

    print("Stage B complete.")
    print(f"candidates={len(candidates)}")
    print(f"logic_drafts={len(logic_drafts)}")
    print(f"output={output_path}")


if __name__ == "__main__":
    main()


import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

from jsonschema import Draft202012Validator


SCHEMA_VERSION = "1.0.0"


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def merge_records(study_id: str, candidates: List[Dict[str, Any]], logic_drafts: List[Dict[str, Any]]) -> Dict[str, Any]:
    logic_by_candidate = {l["candidate_id"]: l for l in logic_drafts}
    specs: List[Dict[str, Any]] = []
    missing_logic: List[str] = []

    for idx, c in enumerate(candidates, start=1):
        cid = c["candidate_id"]
        logic = logic_by_candidate.get(cid)
        if logic is None:
            missing_logic.append(cid)
            continue

        chunk_ids = sorted({ev.get("chunk_id", "") for ev in c.get("source_evidence", []) if ev.get("chunk_id")})
        spec = {
            "spec_id": f"pd:{idx:05d}",
            "study_id": study_id,
            "schema_version": SCHEMA_VERSION,
            "status": "draft",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "chunk_ids": chunk_ids or ["unknown_chunk"],
            "deviation_title": c["deviation_title"],
            "deviation_category": c["deviation_category"],
            "protocol_rule_description": c["protocol_rule_description"],
            "candidate_trigger_condition": c["candidate_trigger_condition"],
            "required_source_data_domain_hints": logic["required_source_data_domain_hints"],
            "timing_anchor": c["timing_anchor"],
            "allowed_window": c["allowed_window"],
            "exceptions_notes": c.get("exceptions_notes", ""),
            "source_evidence": c["source_evidence"],
            "confidence": max(0.0, min(1.0, float((c.get("confidence", 0.0) + logic.get("confidence", 0.0)) / 2))),
            "ambiguity_flag": bool(c.get("ambiguity_flag", False) or logic.get("ambiguity_flag", False)),
            "reviewer_notes": c.get("reviewer_notes", "") or logic.get("reviewer_notes", ""),
        }
        specs.append(spec)

    return {"specs": specs, "missing_logic": missing_logic}


def validate_output(output_data: Dict[str, Any], schema: Dict[str, Any]) -> List[str]:
    validator = Draft202012Validator(schema)
    errors = sorted(validator.iter_errors(output_data), key=lambda e: e.path)
    return [e.message for e in errors]


def main() -> None:
    parser = argparse.ArgumentParser(description="Merge Stage A and Stage B outputs into pd_draft_specs.json")
    parser.add_argument("--study-id", required=True)
    parser.add_argument(
        "--candidates",
        default=None,
        help="Path to candidates.json. Defaults to output/<study-id>/pd/candidates.json",
    )
    parser.add_argument(
        "--logic",
        default=None,
        help="Path to logic_drafts.json. Defaults to output/<study-id>/pd/logic_drafts.json",
    )
    parser.add_argument(
        "--schema",
        default="schemas/pd_draft_spec.schema.json",
        help="Path to pd_draft_spec schema JSON",
    )
    parser.add_argument(
        "--output",
        default=None,
        help="Output path. Defaults to output/<study-id>/pd/pd_draft_specs.json",
    )
    args = parser.parse_args()

    candidates_path = (
        Path(args.candidates)
        if args.candidates
        else Path("output") / args.study_id / "pd" / "candidates.json"
    )
    logic_path = (
        Path(args.logic)
        if args.logic
        else Path("output") / args.study_id / "pd" / "logic_drafts.json"
    )
    output_path = (
        Path(args.output)
        if args.output
        else Path("output") / args.study_id / "pd" / "pd_draft_specs.json"
    )

    candidates_data = read_json(candidates_path)
    logic_data = read_json(logic_path)
    schema = read_json(Path(args.schema))

    merged = merge_records(
        args.study_id,
        candidates_data.get("candidates", []),
        logic_data.get("logic_drafts", []),
    )

    out = {
        "schema_version": SCHEMA_VERSION,
        "study_id": args.study_id,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "pd_draft_specs": merged["specs"],
    }

    errors = validate_output(out, schema)
    if errors:
        raise ValueError("Schema validation failed: " + "; ".join(errors[:10]))
    if merged["missing_logic"]:
        raise ValueError(f"Missing logic drafts for candidates: {merged['missing_logic'][:10]}")

    write_json(output_path, out)
    print("Merge + validation complete.")
    print(f"pd_draft_specs={len(out['pd_draft_specs'])}")
    print(f"output={output_path}")


if __name__ == "__main__":
    main()


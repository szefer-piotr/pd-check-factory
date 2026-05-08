"""Pure data model helpers for the left-rail V2 wizard UI."""

from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Tuple

from pdcheck_factory import paths
from pdcheck_factory.json_util import read_json

_PREF_RE = re.compile(r"^p[0-9]+$")


@dataclass(frozen=True)
class WizardStep:
    id: str
    number: int
    title: str
    kind: str
    requires: List[Tuple[Path, str]]
    produces: List[Tuple[Path, str]]


def artifact_exists(path: Path, kind: str) -> bool:
    if kind == "dir":
        return path.is_dir()
    if kind == "dir_nonempty":
        return path.is_dir() and any(path.iterdir())
    return path.is_file()


def wizard_steps(study_id: str, output_dir: Path) -> List[WizardStep]:
    protocol_md = (
        paths.local_extraction_opendataloader(study_id, "protocol", output_dir)
        / "rendered"
        / "source.md"
    )
    acrf_md = (
        paths.local_extraction_layout(study_id, "acrf", output_dir)
        / "rendered"
        / "source.md"
    )
    toc_dir = paths.local_extraction_layout(study_id, "acrf", output_dir) / "rendered" / "sections_toc"
    return [
        WizardStep("extract_protocol", 1, "Extract protocol", "automated_batch", [], [(protocol_md, "file")]),
        WizardStep(
            "extract_acrf",
            2,
            "Extract aCRF",
            "automated_batch",
            [(protocol_md, "file")],
            [(acrf_md, "file")],
        ),
        WizardStep(
            "split_toc",
            3,
            "Split aCRF TOC",
            "automated_batch",
            [(acrf_md, "file")],
            [(toc_dir, "dir_nonempty")],
        ),
        WizardStep(
            "v2_step_1",
            4,
            "V2-1 Summarize aCRF",
            "automated_batch",
            [(toc_dir, "dir_nonempty"), (protocol_md, "file")],
            [(paths.local_acrf_summary_text_merged(study_id, output_dir), "file")],
        ),
        WizardStep(
            "v2_step_2",
            5,
            "V2-2 Protocol paragraph index",
            "automated_batch",
            [(paths.local_acrf_summary_text_merged(study_id, output_dir), "file")],
            [(paths.local_protocol_paragraph_index_json(study_id, output_dir), "file")],
        ),
        WizardStep(
            "v2_step_3",
            6,
            "V2-3 Protocol rules extraction",
            "automated_batch",
            [(paths.local_protocol_paragraph_index_json(study_id, output_dir), "file")],
            [(paths.local_rules_parsed_json(study_id, output_dir), "file")],
        ),
        WizardStep(
            "v2_step_4_5",
            7,
            "V2-4/5 Deviations extraction",
            "automated_batch",
            [(paths.local_rules_parsed_json(study_id, output_dir), "file")],
            [(paths.local_deviations_review_state(study_id, output_dir), "file")],
        ),
        WizardStep(
            "workshop",
            8,
            "Deviation + Pseudo workshop",
            "ui_workshop",
            [(paths.local_deviations_review_state(study_id, output_dir), "file")],
            [(paths.local_deviations_validated_json(study_id, output_dir), "file")],
        ),
        WizardStep(
            "step_8",
            9,
            "Pseudo batch (step 8)",
            "automated_batch",
            [
                (paths.local_deviations_validated_json(study_id, output_dir), "file"),
                (paths.local_rules_parsed_json(study_id, output_dir), "file"),
                (paths.local_acrf_summary_text_merged(study_id, output_dir), "file"),
            ],
            [(paths.local_pseudo_logic_review_state(study_id, output_dir), "file")],
        ),
        WizardStep(
            "step_10",
            10,
            "Finalize (step 10)",
            "automated_batch",
            [
                (paths.local_deviations_validated_json(study_id, output_dir), "file"),
                (paths.local_pseudo_logic_validated_json(study_id, output_dir), "file"),
                (paths.local_rules_parsed_json(study_id, output_dir), "file"),
            ],
            [
                (paths.local_final_deviations_json(study_id, output_dir), "file"),
                (paths.local_final_deviations_xlsx(study_id, output_dir), "file"),
            ],
        ),
        WizardStep(
            "final_outputs",
            11,
            "Download final outputs",
            "outputs",
            [],
            [
                (paths.local_final_deviations_json(study_id, output_dir), "file"),
                (paths.local_final_deviations_xlsx(study_id, output_dir), "file"),
            ],
        ),
    ]


TERMINAL_DEVIATION_STATUSES = frozenset({"accepted", "rejected"})


def deviations_all_terminal(study_id: str, output_dir: Path) -> bool:
    """True when review state lists every deviation as accepted or rejected."""
    path = paths.local_deviations_review_state(study_id, output_dir)
    if not path.is_file():
        return False
    try:
        obj = read_json(path)
    except OSError:
        return False
    rows = obj.get("deviations") or []
    if not rows:
        return True
    return all(str(r.get("status", "")).strip() in TERMINAL_DEVIATION_STATUSES for r in rows)


def compute_step_states(
    steps: List[WizardStep],
    workshop_done: bool,
) -> List[Dict[str, object]]:
    out: List[Dict[str, object]] = []
    prior_complete = True
    for step in steps:
        missing = [str(p) for p, kind in step.requires if not artifact_exists(p, kind)]
        if step.id == "workshop":
            produces_done = workshop_done
        else:
            produces_done = all(artifact_exists(p, kind) for p, kind in step.produces)
        if missing:
            status = "blocked"
        elif produces_done:
            status = "complete"
        else:
            status = "ready"
        selectable = prior_complete
        out.append(
            {
                "id": step.id,
                "number": step.number,
                "title": step.title,
                "kind": step.kind,
                "status": status,
                "missing": missing,
                "requires": step.requires,
                "produces": step.produces,
                "selectable": selectable,
            }
        )
        prior_complete = prior_complete and status == "complete"
    return out


def parse_import_csv(csv_bytes: bytes, existing_ids: set[str]) -> tuple[list[dict], list[str]]:
    rows: list[dict] = []
    errors: list[str] = []
    text = csv_bytes.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    required = {"deviation_id", "rule_id", "text", "paragraph_refs"}
    if not reader.fieldnames or not required.issubset(set(reader.fieldnames)):
        return [], ["CSV must contain: deviation_id, rule_id, text, paragraph_refs"]
    seen = set(existing_ids)
    for idx, raw in enumerate(reader, start=2):
        deviation_id = (raw.get("deviation_id") or "").strip()
        rule_id = (raw.get("rule_id") or "").strip()
        text_val = (raw.get("text") or "").strip()
        refs_raw = (raw.get("paragraph_refs") or "").strip()
        refs = [part.strip() for part in refs_raw.split(",") if part.strip()]
        if not deviation_id or not rule_id or not text_val or not refs:
            errors.append(f"Row {idx}: required values missing.")
            continue
        if deviation_id in seen:
            errors.append(f"Row {idx}: duplicate deviation_id '{deviation_id}'.")
            continue
        bad_refs = [ref for ref in refs if not _PREF_RE.match(ref)]
        if bad_refs:
            errors.append(f"Row {idx}: invalid paragraph_refs {bad_refs}.")
            continue
        rows.append(
            {
                "deviation_id": deviation_id,
                "rule_id": rule_id,
                "text": text_val,
                "paragraph_refs": refs,
                "status": "pending",
                "dm_comment": "",
                "entry_source": "imported",
            }
        )
        seen.add(deviation_id)
    return rows, errors

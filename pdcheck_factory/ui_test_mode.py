"""Mode-aware UI adapters for real vs synthetic V2 workflow execution."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Literal, Optional, Tuple

from openpyxl import Workbook

from pdcheck_factory import cli, paths, pipeline_v2
from pdcheck_factory.json_util import read_json, write_json

DataMode = Literal["real", "test", "mixed"]


@dataclass(frozen=True)
class UiModeConfig:
    mode: DataMode
    fixtures_dir: Path


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


# Minimal synthetic aCRF: TOC rows in first lines + Page markers split-toc can anchor.
_SYNTHETIC_ACRF_TEMPLATE = """# Synthetic aCRF (fixture)

<table>
<tr><td>Vital Signs (VIS)</td><td>10</td></tr>
<tr><td>Exposure (EXP)</td><td>25</td></tr>
</table>

Page: Schedule (VIS)
<!-- PageNumber = "Page 10 of 40 pages" -->

## VIS synthetic section

VISIT,VSDTC,VSTEST
VISIT001,01JAN2024,BP


Page: Exposure tab (EXP)
<!-- PageNumber = "Page 25 of 40 pages" -->

## EXP synthetic section

USUBJID,EXDSTXT
VISIT001,WEEK4
"""


def write_synthetic_extraction_outputs(study_id: str, output_dir: Path, config: UiModeConfig) -> None:
    """
    Write minimal protocol + aCRF markdown under extractions/, matching UI step contracts.

    Paragraph text is taken from fixtures so V2 markdown indexing stays aligned with
    synthetic protocol_paragraph_index.json.
    """
    index_obj = _fixture_json(config, "protocol_paragraph_index")
    paragraphs = index_obj.get("paragraphs") or [{"paragraph_id": "p1", "text": "# Protocol\nSynthetic placeholder paragraph."}]
    parts: list[str] = []
    for p in paragraphs:
        t = str(p.get("text", "")).strip()
        if t:
            parts.append(t)
    body = "\n\n".join(parts) if parts else "# Protocol\n\nSynthetic placeholder."

    proto_path = (
        paths.local_extraction_opendataloader(study_id, "protocol", output_dir)
        / "rendered"
        / "source.md"
    )
    proto_path.parent.mkdir(parents=True, exist_ok=True)
    proto_path.write_text(body.strip() + "\n", encoding="utf-8")

    acrf_path = paths.local_extraction_layout(study_id, "acrf", output_dir) / "rendered" / "source.md"
    acrf_path.parent.mkdir(parents=True, exist_ok=True)
    acrf_path.write_text(_SYNTHETIC_ACRF_TEMPLATE, encoding="utf-8")
    print(
        f"[data-mode:test] Synthetic extract: wrote {proto_path} and {acrf_path}",
        flush=True,
    )


def run_extract_for_ui(
    *,
    study_id: str,
    output_dir: Path,
    config: UiModeConfig,
    protocol_blob: Optional[str] = None,
    acrf_blob: Optional[str] = None,
    model_id: Optional[str] = None,
    sas_ttl: int,
    upload: bool,
    skip_acrf: bool,
    upload_only: bool,
    run_opendataloader_ocr: bool,
    opendataloader_only: bool,
    debug_blob: bool,
) -> None:
    """Data prep extract: synthetic files in test mode; real Blob/DI otherwise."""
    if config.mode == "test":
        if skip_acrf:
            proto_path = (
                paths.local_extraction_opendataloader(study_id, "protocol", output_dir)
                / "rendered"
                / "source.md"
            )
            proto_path.parent.mkdir(parents=True, exist_ok=True)
            index_obj = _fixture_json(config, "protocol_paragraph_index")
            paragraphs = index_obj.get("paragraphs") or []
            texts = "\n\n".join(
                str(p.get("text", "")).strip() for p in paragraphs if str(p.get("text", "")).strip()
            )
            proto_path.write_text((texts or "# Protocol\n\nSynthetic.") + "\n", encoding="utf-8")
        else:
            write_synthetic_extraction_outputs(study_id, output_dir, config)
        return
    if config.mode == "real":
        cli.run_extract(
            study_id=study_id,
            protocol_blob=protocol_blob,
            acrf_blob=acrf_blob,
            output_dir=output_dir,
            model_id=model_id,
            sas_ttl=sas_ttl,
            upload=upload,
            skip_acrf=skip_acrf,
            upload_only=upload_only,
            run_opendataloader_ocr=run_opendataloader_ocr,
            opendataloader_only=opendataloader_only,
            debug_blob=debug_blob,
        )
        return
    try:
        cli.run_extract(
            study_id=study_id,
            protocol_blob=protocol_blob,
            acrf_blob=acrf_blob,
            output_dir=output_dir,
            model_id=model_id,
            sas_ttl=sas_ttl,
            upload=upload,
            skip_acrf=skip_acrf,
            upload_only=upload_only,
            run_opendataloader_ocr=run_opendataloader_ocr,
            opendataloader_only=opendataloader_only,
            debug_blob=debug_blob,
        )
    except BaseException:
        write_synthetic_extraction_outputs(study_id, output_dir, config)


def run_split_toc_for_ui(
    *,
    study_id: str,
    output_dir: Path,
    config: UiModeConfig,
    write_manifest: bool = True,
) -> Tuple[int, Path]:
    """Split aCRF TOC sections; synthetic prep on failure in mixed mode."""

    def _split() -> Tuple[int, Path]:
        n_written, manifest = cli.run_acrf_split_toc(
            source_md=cli._read_acrf_source_md(study_id, output_dir),
            destination_dir=cli._default_acrf_toc_dir(study_id, output_dir),
            write_manifest=write_manifest,
        )
        print(f"[TOC split] wrote {n_written} section file(s) under {manifest.parent}", flush=True)
        return n_written, manifest

    if config.mode == "test":
        return _split()
    if config.mode == "real":
        return _split()
    try:
        return _split()
    except BaseException:
        write_synthetic_extraction_outputs(study_id, output_dir, config)
        return _split()


def _fixture_json(config: UiModeConfig, name: str) -> Dict[str, Any]:
    return read_json(config.fixtures_dir / f"{name}.json")


def _synthetic_acrf_summary(study_id: str, config: UiModeConfig) -> Dict[str, Any]:
    obj = _fixture_json(config, "acrf_summary_text_merged")
    obj["study_id"] = study_id
    obj["generated_at"] = _iso_now()
    return obj


def _synthetic_protocol_index(study_id: str, config: UiModeConfig) -> Dict[str, Any]:
    obj = _fixture_json(config, "protocol_paragraph_index")
    obj["study_id"] = study_id
    obj["generated_at"] = _iso_now()
    return obj


def _synthetic_rules(study_id: str, config: UiModeConfig) -> Dict[str, Any]:
    obj = _fixture_json(config, "rules_parsed")
    obj["study_id"] = study_id
    obj["generated_at"] = _iso_now()
    return obj


def _synthetic_deviations(study_id: str, config: UiModeConfig) -> Dict[str, Any]:
    obj = _fixture_json(config, "deviations_review_state")
    obj["study_id"] = study_id
    obj["generated_at"] = _iso_now()
    return obj


def _synthetic_pseudo(study_id: str, config: UiModeConfig) -> Dict[str, Any]:
    obj = _fixture_json(config, "pseudo_logic_review_state")
    obj["study_id"] = study_id
    obj["generated_at"] = _iso_now()
    return obj


def _synthetic_final(study_id: str, config: UiModeConfig) -> Dict[str, Any]:
    obj = _fixture_json(config, "final_deviations")
    obj["study_id"] = study_id
    obj["generated_at"] = _iso_now()
    return obj


def _write_simple_final_xlsx(final_obj: Dict[str, Any], out_path: Path) -> None:
    wb = Workbook()
    ws = wb.active
    ws.title = "Final Deviations"
    ws.append(["rule_id", "deviation_id", "rule_title", "deviation_text", "paragraph_refs", "pseudo_logic"])
    for item in final_obj.get("items", []):
        ws.append(
            [
                item.get("rule_id", ""),
                item.get("deviation_id", ""),
                item.get("rule_title", ""),
                item.get("deviation_text", ""),
                ", ".join(item.get("paragraph_refs", [])),
                item.get("pseudo_logic", ""),
            ]
        )
    out_path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(out_path)


def _write_synthetic_steps(study_id: str, output_dir: Path, from_step: int, to_step: int, config: UiModeConfig) -> None:
    if from_step <= 1 <= to_step:
        write_json(paths.local_acrf_summary_text_merged(study_id, output_dir), _synthetic_acrf_summary(study_id, config))
    if from_step <= 2 <= to_step:
        write_json(paths.local_protocol_paragraph_index_json(study_id, output_dir), _synthetic_protocol_index(study_id, config))
    if from_step <= 3 <= to_step:
        write_json(paths.local_rules_parsed_json(study_id, output_dir), _synthetic_rules(study_id, config))
    if from_step <= 5 and to_step >= 4:
        dev = _synthetic_deviations(study_id, config)
        write_json(paths.local_deviations_parsed_json(study_id, output_dir), dev)
        write_json(paths.local_deviations_review_state(study_id, output_dir), dev)
        write_json(paths.local_deviations_validated_json(study_id, output_dir), dev)
    if from_step <= 8 <= to_step:
        pseudo = _synthetic_pseudo(study_id, config)
        write_json(paths.local_pseudo_logic_review_state(study_id, output_dir), pseudo)
        write_json(paths.local_pseudo_logic_validated_json(study_id, output_dir), pseudo)
    if from_step <= 10 <= to_step:
        final = _synthetic_final(study_id, config)
        write_json(paths.local_final_deviations_json(study_id, output_dir), final)
        _write_simple_final_xlsx(final, paths.local_final_deviations_xlsx(study_id, output_dir))


def run_steps(study_id: str, output_dir: Path, from_step: int, to_step: int, config: UiModeConfig) -> None:
    if config.mode == "test":
        _write_synthetic_steps(study_id, output_dir, from_step, to_step, config)
        return
    if config.mode == "real":
        pipeline_v2.run_steps(study_id=study_id, output_dir=output_dir, from_step=from_step, to_step=to_step)
        return
    try:
        pipeline_v2.run_steps(study_id=study_id, output_dir=output_dir, from_step=from_step, to_step=to_step)
    except Exception:
        _write_synthetic_steps(study_id, output_dir, from_step, to_step, config)


def step10_finalize(study_id: str, output_dir: Path, config: UiModeConfig) -> Dict[str, Any]:
    if config.mode == "test":
        final = _synthetic_final(study_id, config)
        write_json(paths.local_final_deviations_json(study_id, output_dir), final)
        _write_simple_final_xlsx(final, paths.local_final_deviations_xlsx(study_id, output_dir))
        return final
    if config.mode == "real":
        return pipeline_v2.step10_finalize(study_id=study_id, output_dir=output_dir)
    try:
        return pipeline_v2.step10_finalize(study_id=study_id, output_dir=output_dir)
    except Exception:
        final = _synthetic_final(study_id, config)
        write_json(paths.local_final_deviations_json(study_id, output_dir), final)
        _write_simple_final_xlsx(final, paths.local_final_deviations_xlsx(study_id, output_dir))
        return final


def generate_pseudo_logic_for_deviation(
    *,
    study_id: str,
    output_dir: Path,
    deviation: Dict[str, Any],
    config: UiModeConfig,
    rule_by_id: Optional[Dict[str, Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    if config.mode == "test":
        rid = str(deviation.get("rule_id", ""))
        did = str(deviation.get("deviation_id", ""))
        rule_title = (rule_by_id or {}).get(rid, {}).get("title", "")
        return {
            "deviation_id": did,
            "rule_id": rid,
            "rule_title": rule_title,
            "pseudo_logic": f"SELECT 1 -- synthetic pseudo for {did}",
            "programmable": True,
            "programmability_note": "Synthetic mode marks this deviation as programmable.",
            "status": "pending",
            "dm_comment": "",
        }
    if config.mode == "real":
        return pipeline_v2.generate_pseudo_logic_for_deviation(
            study_id=study_id,
            output_dir=output_dir,
            deviation=deviation,
            rule_by_id=rule_by_id,
        )
    try:
        return pipeline_v2.generate_pseudo_logic_for_deviation(
            study_id=study_id,
            output_dir=output_dir,
            deviation=deviation,
            rule_by_id=rule_by_id,
        )
    except Exception:
        rid = str(deviation.get("rule_id", ""))
        did = str(deviation.get("deviation_id", ""))
        rule_title = (rule_by_id or {}).get(rid, {}).get("title", "")
        return {
            "deviation_id": did,
            "rule_id": rid,
            "rule_title": rule_title,
            "pseudo_logic": f"SELECT 1 -- mixed fallback pseudo for {did}",
            "programmable": True,
            "programmability_note": "Mixed mode fallback produced deterministic pseudo logic.",
            "status": "pending",
            "dm_comment": "",
        }


def refine_single_deviation_with_comment(
    *,
    study_id: str,
    output_dir: Path,
    row: Dict[str, Any],
    dm_comment: str,
    run_revision_cycle: bool,
    config: UiModeConfig,
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    if config.mode == "test":
        updated = dict(row)
        updated["dm_comment"] = dm_comment
        if run_revision_cycle and dm_comment.strip():
            updated["text"] = f"{row.get('text', '')} [synthetic revision: {dm_comment.strip()}]"
        audit = {
            "study_id": study_id,
            "review_type": "deviations",
            "deviation_id": str(updated.get("deviation_id", "")),
            "updated_rows": 1,
            "revised_rows": 1 if (run_revision_cycle and dm_comment.strip()) else 0,
            "run_revision_cycle": run_revision_cycle,
        }
        return updated, audit
    if config.mode == "real":
        return pipeline_v2.refine_single_deviation_with_comment(
            study_id=study_id,
            output_dir=output_dir,
            row=row,
            dm_comment=dm_comment,
            run_revision_cycle=run_revision_cycle,
        )
    try:
        return pipeline_v2.refine_single_deviation_with_comment(
            study_id=study_id,
            output_dir=output_dir,
            row=row,
            dm_comment=dm_comment,
            run_revision_cycle=run_revision_cycle,
        )
    except Exception:
        updated = dict(row)
        updated["dm_comment"] = dm_comment
        if run_revision_cycle and dm_comment.strip():
            updated["text"] = f"{row.get('text', '')} [mixed fallback revision: {dm_comment.strip()}]"
        audit = {
            "study_id": study_id,
            "review_type": "deviations",
            "deviation_id": str(updated.get("deviation_id", "")),
            "updated_rows": 1,
            "revised_rows": 1 if (run_revision_cycle and dm_comment.strip()) else 0,
            "run_revision_cycle": run_revision_cycle,
        }
        return updated, audit

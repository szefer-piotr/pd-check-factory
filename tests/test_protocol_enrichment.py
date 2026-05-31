from __future__ import annotations

import json
from io import BytesIO
from pathlib import Path
from typing import Any, Dict

import pytest
from openpyxl import Workbook

from pdcheck_factory import paths, protocol_enrichment, text_parse
from pdcheck_factory.json_util import read_json
from pdcheck_factory.deviation_contract import build_enriched_row
from pdcheck_factory.pd_spec_export import PD_SPEC_HEADERS, PD_SPEC_SHEET_TITLE
from pdcheck_factory.protocol_enrichment import (
    EnrichmentProposalOutput,
    _merge_enrichment_results,
    enrich_imported_deviation,
)


def _minimal_pd_spec_xlsx() -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = PD_SPEC_SHEET_TITLE
    ws.append(PD_SPEC_HEADERS)
    ws.append(
        [
            "Eligibility Criteria",
            "Age",
            "Subject enrolled below minimum age",
            "",
            "Major",
            "Programmable",
            "",
            "",
            "RAVE",
            "",
            "",
            "",
            "",
        ]
    )
    buffer = BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


def test_merge_enrichment_keeps_imported_text_and_sets_suggested() -> None:
    deviation = {
        "deviation_id": "dev-import-abc",
        "text": "Original text",
        "status": "pending",
    }
    protocol_grounding = {
        "paragraph_refs": ["p1"],
        "data_support_note": "Protocol note",
        "grounding_error": "",
    }
    acrf_grounding = {
        "pseudo_logic_plain_english": "IF visit out of window THEN flag",
        "programmable": "yes",
        "programmability_risk": "medium",
        "programmability_rationale": "SV dates",
        "acrf_sections": ["SV"],
        "data_support_note": "aCRF note",
        "grounding_error": "",
    }
    proposal = EnrichmentProposalOutput(
        suggested_deviation_text="Visit outside Day 3-5 window per protocol",
        paragraph_refs=["p1"],
        assumptions=["Visit dates populated"],
        programmability_risk="medium",
    )
    merged, row_updates = _merge_enrichment_results(
        deviation=deviation,
        protocol_grounding=protocol_grounding,
        acrf_grounding=acrf_grounding,
        proposal=proposal,
        valid_ids={"p1", "p2"},
        enrichment_errors={},
    )
    assert row_updates["text"] == "Original text"
    assert row_updates["suggested_deviation_text"] == "Visit outside Day 3-5 window per protocol"
    assert merged["suggested_deviation_text"] == "Visit outside Day 3-5 window per protocol"
    assert row_updates["pd_spec_import"]["enrichment_status"] == "ok"

    enriched_row = build_enriched_row(deviation, row_updates)
    assert enriched_row["original_deviation_text"] == "Original text"
    assert enriched_row["suggested_deviation_text"] == "Visit outside Day 3-5 window per protocol"
    assert enriched_row["text"] == "Original text"


def test_enrich_imported_deviation_writes_artifact_sequential(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    study_id = "ENRICH-UNIT"
    index_obj = {
        "paragraphs": [
            {"paragraph_id": "p1", "text": "Visit must occur Day 3 to Day 5."},
        ]
    }
    deviation = {
        "deviation_id": "dev-import-test1",
        "rule_id": "pd-spec-rule-x",
        "text": "Visit out of window",
        "paragraph_refs": [],
        "protocol_deviation_category": "Visit",
        "protocol_deviation_sub_category": "Timing",
        "classification": "Major",
        "entry_source": "imported_pd_spec",
        "status": "pending",
    }
    call_order: list[str] = []

    def fake_chat_text_repairs(**kwargs: Any) -> str:
        label = str(kwargs.get("label", ""))
        if "ground-protocol" in label:
            call_order.append("protocol")
            return (
                "<<<BEGIN_GROUNDING>>>\n"
                "PARAGRAPH_REFS: p1\n"
                "DATA_SUPPORT_NOTE: SV visit dates\n"
                "<<<END_GROUNDING>>>"
            )
        if "ground-acrf" in label:
            call_order.append("acrf")
            return (
                "<<<BEGIN_ACRF_GROUNDING>>>\n"
                "PSEUDO_LOGIC_PLAIN_ENGLISH: Compare visit date to dose date + 3..5\n"
                "PROGRAMMABLE: yes\n"
                "PROGRAMMABILITY_RISK: low\n"
                "PROGRAMMABILITY_RATIONALE: SV has dates\n"
                "ACRF_SECTIONS: SV\n"
                "DATA_SUPPORT_NOTE: Use visit dates\n"
                "<<<END_ACRF_GROUNDING>>>"
            )
        raise AssertionError(f"unexpected label {label}")

    def fake_chat_json(**kwargs: Any) -> Dict[str, Any]:
        call_order.append("proposal")
        return EnrichmentProposalOutput(
            suggested_deviation_text="Visit outside Day 3-5 window",
            paragraph_refs=["p1"],
            programmability_risk="low",
        ).model_dump(mode="json")

    monkeypatch.setattr(protocol_enrichment.llm, "chat_text_repairs", fake_chat_text_repairs)
    monkeypatch.setattr(protocol_enrichment.llm, "chat_json", fake_chat_json)
    monkeypatch.setattr(protocol_enrichment.study_artifact_sync, "mirror_upload_path", lambda *_a, **_k: None)

    updated = enrich_imported_deviation(
        study_id=study_id,
        output_dir=tmp_path,
        deviation=deviation,
        index_obj=index_obj,
        acrf_summary='{"datasets":[]}',
        protocol_paragraphs="p1: Visit must occur Day 3 to Day 5.",
    )
    assert call_order == ["protocol", "acrf", "proposal"]
    assert updated["text"] == "Visit out of window"
    assert updated["suggested_deviation_text"] == "Visit outside Day 3-5 window"
    assert updated["paragraph_refs"] == ["p1"]
    assert updated["original_deviation_text"] == "Visit out of window"

    artifact_path = paths.local_protocol_enrichment_json(study_id, tmp_path, "dev-import-test1")
    assert artifact_path.is_file()
    artifact = read_json(artifact_path)
    assert artifact["schema_version"] == "1.1.0"
    assert artifact["enrichment_status"] in {"ok", "partial"}
    assert artifact["merged"]["suggested_deviation_text"] == "Visit outside Day 3-5 window"


def test_run_protocol_enrichment_batch(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    study_id = "ENRICH-BATCH"
    index_path = paths.local_protocol_paragraph_index_json(study_id, tmp_path)
    index_path.parent.mkdir(parents=True, exist_ok=True)
    index_path.write_text(
        json.dumps({"paragraphs": [{"paragraph_id": "p1", "text": "Rule text"}]}),
        encoding="utf-8",
    )
    acrf_path = paths.local_acrf_summary_text_merged(study_id, tmp_path)
    acrf_path.parent.mkdir(parents=True, exist_ok=True)
    acrf_path.write_text('{"datasets":[]}', encoding="utf-8")

    workbook = _minimal_pd_spec_xlsx()

    def fake_chat_text_repairs(**kwargs: Any) -> str:
        label = str(kwargs.get("label", ""))
        if "ground-protocol" in label:
            return (
                "<<<BEGIN_GROUNDING>>>\nPARAGRAPH_REFS: p1\n"
                "DATA_SUPPORT_NOTE: note\n<<<END_GROUNDING>>>"
            )
        return (
            "<<<BEGIN_ACRF_GROUNDING>>>\n"
            "PSEUDO_LOGIC_PLAIN_ENGLISH: logic\n"
            "PROGRAMMABLE: yes\nPROGRAMMABILITY_RISK: low\n"
            "PROGRAMMABILITY_RATIONALE: ok\nACRF_SECTIONS: SV\n"
            "DATA_SUPPORT_NOTE: note\n<<<END_ACRF_GROUNDING>>>"
        )

    def fake_chat_json(**_kwargs: Any) -> Dict[str, Any]:
        return EnrichmentProposalOutput(
            suggested_deviation_text="Refined suggested text",
            paragraph_refs=["p1"],
        ).model_dump(mode="json")

    monkeypatch.setattr(protocol_enrichment.llm, "chat_text_repairs", fake_chat_text_repairs)
    monkeypatch.setattr(protocol_enrichment.llm, "chat_json", fake_chat_json)
    monkeypatch.setattr(protocol_enrichment.study_artifact_sync, "mirror_upload_path", lambda *_a, **_k: None)

    result = protocol_enrichment.run_protocol_enrichment(
        study_id, tmp_path, workbook_bytes=workbook
    )
    assert result["pd_spec_import_mode"] == "enrich"
    assert result["deviation_count"] >= 1

    enriched_review = paths.local_deviations_review_enriched_pd_spec_json(study_id, tmp_path)
    assert enriched_review.is_file()
    review_obj = read_json(enriched_review)
    assert review_obj["pd_spec_import_mode"] == "enrich"
    first = review_obj["deviations"][0]
    assert first.get("original_deviation_text")
    assert first["text"] != "Refined suggested text"
    assert first.get("suggested_deviation_text") == "Refined suggested text"


def test_parse_acrf_grounding_block() -> None:
    text = (
        "<<<BEGIN_ACRF_GROUNDING>>>\n"
        "PSEUDO_LOGIC_PLAIN_ENGLISH: IF x THEN y\n"
        "PROGRAMMABLE: yes\n"
        "PROGRAMMABILITY_RISK: low\n"
        "PROGRAMMABILITY_RATIONALE: ok\n"
        "ACRF_SECTIONS: SV, DM\n"
        "DATA_SUPPORT_NOTE: note\n"
        "<<<END_ACRF_GROUNDING>>>"
    )
    parsed = text_parse.parse_acrf_grounding_block(text)
    assert parsed is not None
    assert parsed["pseudo_logic_plain_english"] == "IF x THEN y"
    assert parsed["programmable"] == "yes"
    assert parsed["acrf_sections"] == ["SV", "DM"]

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict
from unittest.mock import patch

import pytest

from pdcheck_factory import paths, protocol_enrichment
from pdcheck_factory.json_util import read_json
from pdcheck_factory.protocol_enrichment import (
    CaveatsEnrichmentOutput,
    CritiqueEnrichmentOutput,
    LogicEnrichmentOutput,
    _merge_enrichment_outputs,
    enrich_imported_deviation,
    run_parallel_json_tasks,
)


def test_run_parallel_json_tasks_collects_results_and_errors() -> None:
    def ok() -> str:
        return "ok"

    def fail() -> str:
        raise ValueError("boom")

    results = run_parallel_json_tasks([("a", ok), ("b", fail)])
    assert results["a"] == "ok"
    assert isinstance(results["b"], ValueError)


def test_merge_enrichment_updates_text_when_confident() -> None:
    deviation = {
        "deviation_id": "dev-import-abc",
        "text": "Original text",
        "status": "pending",
    }
    logic = LogicEnrichmentOutput(
        improved_deviation_text="Improved explicit text",
        improved_pseudo_logic_plain_english="IF visit out of window THEN flag",
        paragraph_refs=["p1"],
        data_support_note="Use SV dataset",
        confidence=0.85,
        block_auto_text_update=False,
    )
    caveats = CaveatsEnrichmentOutput(
        assumptions=["Visit dates populated"],
        caveats=["Window depends on dose date"],
    )
    critique = CritiqueEnrichmentOutput(
        weak_spots=["Timing anchor unclear"],
        programmability_risk="medium",
    )
    merged, row_updates = _merge_enrichment_outputs(
        deviation=deviation,
        logic=logic,
        caveats=caveats,
        critique=critique,
        valid_ids={"p1", "p2"},
        enrichment_errors={},
    )
    assert row_updates["text"] == "Improved explicit text"
    assert merged["paragraph_refs"] == ["p1"]
    assert row_updates["enrichment_status"] == "ok"
    assert "assumptions" in merged and merged["assumptions"]


def test_merge_blocks_text_update_when_critique_blocks() -> None:
    deviation = {"deviation_id": "dev-1", "text": "Keep me", "status": "pending"}
    logic = LogicEnrichmentOutput(
        improved_deviation_text="Should not apply",
        confidence=0.95,
        block_auto_text_update=False,
    )
    critique = CritiqueEnrichmentOutput(block_auto_text_update=True, programmability_risk="high")
    _, row_updates = _merge_enrichment_outputs(
        deviation=deviation,
        logic=logic,
        caveats=None,
        critique=critique,
        valid_ids=set(),
        enrichment_errors={},
    )
    assert row_updates["text"] == "Keep me"
    assert row_updates["status"] == "to_review"


def test_enrich_imported_deviation_writes_artifact(
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

    def fake_chat_json(**kwargs: Any) -> Dict[str, Any]:
        model = kwargs["response_model"]
        if model is LogicEnrichmentOutput:
            return LogicEnrichmentOutput(
                improved_deviation_text="Visit outside Day 3-5 window",
                improved_pseudo_logic_plain_english="Compare visit date to dose date + 3..5",
                paragraph_refs=["p1"],
                data_support_note="SV dates",
                confidence=0.8,
            ).model_dump(mode="json")
        if model is CaveatsEnrichmentOutput:
            return CaveatsEnrichmentOutput(assumptions=["Dose date available"]).model_dump(mode="json")
        if model is CritiqueEnrichmentOutput:
            return CritiqueEnrichmentOutput(programmability_risk="low").model_dump(mode="json")
        raise AssertionError(f"unexpected model {model}")

    monkeypatch.setattr(protocol_enrichment.llm, "chat_json", fake_chat_json)
    monkeypatch.setattr(protocol_enrichment.study_artifact_sync, "mirror_upload_path", lambda *_a, **_k: None)

    updated = enrich_imported_deviation(
        study_id=study_id,
        output_dir=tmp_path,
        deviation=deviation,
        index_obj=index_obj,
        acrf_summary='{"datasets":[]}',
    )
    assert updated["text"] == "Visit outside Day 3-5 window"
    assert updated["paragraph_refs"] == ["p1"]

    artifact_path = paths.local_protocol_enrichment_json(study_id, tmp_path, "dev-import-test1")
    assert artifact_path.is_file()
    artifact = read_json(artifact_path)
    assert artifact["enrichment_status"] in {"ok", "partial"}
    assert artifact["merged"]["assumptions"] == ["Dose date available"]


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

    from tests.test_processing_preprocess import _minimal_pd_spec_xlsx

    workbook = _minimal_pd_spec_xlsx()

    call_count = {"n": 0}

    def fake_chat_json(**kwargs: Any) -> Dict[str, Any]:
        call_count["n"] += 1
        model = kwargs["response_model"]
        if model is LogicEnrichmentOutput:
            return LogicEnrichmentOutput(
                improved_deviation_text="Refined",
                paragraph_refs=["p1"],
                confidence=0.9,
            ).model_dump(mode="json")
        if model is CaveatsEnrichmentOutput:
            return CaveatsEnrichmentOutput().model_dump(mode="json")
        if model is CritiqueEnrichmentOutput:
            return CritiqueEnrichmentOutput().model_dump(mode="json")
        raise AssertionError("unknown model")

    monkeypatch.setattr(protocol_enrichment.llm, "chat_json", fake_chat_json)
    monkeypatch.setattr(protocol_enrichment.study_artifact_sync, "mirror_upload_path", lambda *_a, **_k: None)

    result = protocol_enrichment.run_protocol_enrichment(
        study_id, tmp_path, workbook_bytes=workbook
    )
    assert result["pd_spec_import_mode"] == "enrich"
    assert result["deviation_count"] >= 1
    assert call_count["n"] >= 3

    enriched_review = paths.local_deviations_review_enriched_pd_spec_json(study_id, tmp_path)
    assert enriched_review.is_file()
    review_obj = read_json(enriched_review)
    assert review_obj["pd_spec_import_mode"] == "enrich"

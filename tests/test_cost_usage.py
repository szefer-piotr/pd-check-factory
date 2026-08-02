"""Tests for cost usage pricing, aggregation, and page counting."""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from pdcheck_factory import cost_usage, pricing
from pdcheck_factory.llm import _log_chat_usage
from pdcheck_factory.paths import local_pipeline_cost_usage_json


def test_family_prefix_and_llm_lookup():
    table = pricing.PricingTable(
        llm_rates={
            "default": {"prompt_usd_per_1m": 1.0, "completion_usd_per_1m": 2.0},
            "gpt-4o": {"prompt_usd_per_1m": 2.5, "completion_usd_per_1m": 10.0},
            "gpt-4o-mini": {"prompt_usd_per_1m": 0.15, "completion_usd_per_1m": 0.60},
            "my-deploy": {"prompt_usd_per_1m": 9.0, "completion_usd_per_1m": 9.0},
        },
        di_rates={"default": 0.01, "prebuilt-layout": 0.01},
        source="defaults",
    )
    rate = pricing.lookup_llm_rate(deployment="my-deploy", model="gpt-4o", table=table)
    assert rate is not None
    assert rate.matched_key == "my-deploy"

    rate = pricing.lookup_llm_rate(deployment="other", model="gpt-4o-2024-08-06", table=table)
    assert rate is not None
    assert rate.matched_key == "gpt-4o"

    rate = pricing.lookup_llm_rate(deployment="mystery", model="mystery", table=table)
    assert rate is not None
    assert rate.matched_key == "default"


def test_llm_cost_usd_math():
    table = pricing.PricingTable(
        llm_rates={
            "default": {"prompt_usd_per_1m": 1.0, "completion_usd_per_1m": 2.0},
        },
        di_rates={"default": 0.01},
        source="defaults",
    )
    cost, key = pricing.llm_cost_usd(
        prompt_tokens=1_000_000,
        completion_tokens=500_000,
        deployment="x",
        table=table,
    )
    assert key == "default"
    assert cost == pytest.approx(1.0 + 1.0)


def test_di_cost_usd_and_env_override(monkeypatch):
    monkeypatch.setenv("COST_DI_USD_PER_PAGE", "0.02")
    monkeypatch.delenv("COST_LLM_RATES_JSON", raising=False)
    monkeypatch.delenv("COST_PRICING_FILE", raising=False)
    table = pricing.load_pricing_table()
    assert table.source == "env"
    cost, key = pricing.di_cost_usd(pages=10, model_id="prebuilt-layout", table=table)
    assert key in {"prebuilt-layout", "default"}
    assert cost == pytest.approx(0.2)


def test_pricing_file_override(tmp_path: Path, monkeypatch):
    path = tmp_path / "pricing.json"
    path.write_text(
        json.dumps(
            {
                "llm": {"default": {"prompt_usd_per_1m": 3.0, "completion_usd_per_1m": 6.0}},
                "document_intelligence": {"prebuilt-layout": 0.05},
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("COST_PRICING_FILE", str(path))
    monkeypatch.delenv("COST_LLM_RATES_JSON", raising=False)
    monkeypatch.delenv("COST_DI_USD_PER_PAGE", raising=False)
    table = pricing.load_pricing_table()
    assert table.source == "file"
    cost, _ = pricing.llm_cost_usd(prompt_tokens=1_000_000, completion_tokens=0, table=table)
    assert cost == pytest.approx(3.0)
    di_cost, _ = pricing.di_cost_usd(pages=2, model_id="prebuilt-layout", table=table)
    assert di_cost == pytest.approx(0.1)


def test_di_page_count():
    result = SimpleNamespace(pages=[{}, {}, {}])
    assert cost_usage.di_page_count(result, {"pages": [{}, {}]}) == 3
    assert cost_usage.di_page_count(SimpleNamespace(), {"pages": [{}, {}]}) == 2
    assert cost_usage.di_page_count(SimpleNamespace(), {}) == 0


def test_record_aggregates_by_step(tmp_path: Path, monkeypatch):
    monkeypatch.delenv("COST_PRICING_FILE", raising=False)
    monkeypatch.delenv("COST_LLM_RATES_JSON", raising=False)
    monkeypatch.delenv("COST_DI_USD_PER_PAGE", raising=False)
    study_id = "STUDY-COST"
    with cost_usage.session(study_id, tmp_path, step="extract-rules"):
        cost_usage.record_llm_usage(
            deployment="gpt-4o",
            model="gpt-4o",
            prompt_tokens=1000,
            completion_tokens=500,
            total_tokens=1500,
            label="rules",
        )
        cost_usage.record_llm_usage(
            deployment="gpt-4o",
            model="gpt-4o",
            prompt_tokens=2000,
            completion_tokens=0,
            total_tokens=2000,
            label="rules",
        )
    with cost_usage.session(study_id, tmp_path, step="extract-inputs"):
        cost_usage.record_di_usage(doc_role="protocol", model_id="prebuilt-layout", pages=12)

    path = local_pipeline_cost_usage_json(study_id, tmp_path)
    assert path.is_file()
    artifact = cost_usage.load_artifact(study_id, tmp_path)
    assert artifact["totals"]["llm"]["calls"] == 2
    assert artifact["totals"]["llm"]["prompt_tokens"] == 3000
    assert artifact["totals"]["llm"]["completion_tokens"] == 500
    assert artifact["totals"]["llm"]["total_tokens"] == 3500
    assert artifact["totals"]["document_intelligence"]["calls"] == 1
    assert artifact["totals"]["document_intelligence"]["pages"] == 12
    assert artifact["totals"]["cost_usd"] > 0
    assert artifact["by_step"]["extract-rules"]["llm"]["calls"] == 2
    assert artifact["by_step"]["extract-inputs"]["document_intelligence"]["pages"] == 12
    assert len(artifact["events"]) == 3


def test_event_cap(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(cost_usage, "MAX_EVENTS", 3)
    study_id = "CAP"
    with cost_usage.session(study_id, tmp_path, step="s"):
        for i in range(5):
            cost_usage.record_di_usage(doc_role="protocol", model_id="prebuilt-layout", pages=1)
    artifact = cost_usage.load_artifact(study_id, tmp_path)
    assert len(artifact["events"]) == 3
    assert artifact["totals"]["document_intelligence"]["calls"] == 5
    assert artifact["totals"]["document_intelligence"]["pages"] == 5


def test_log_chat_usage_records_when_session_active(tmp_path: Path, monkeypatch):
    monkeypatch.delenv("COST_PRICING_FILE", raising=False)
    monkeypatch.delenv("COST_LLM_RATES_JSON", raising=False)
    monkeypatch.delenv("COST_DI_USD_PER_PAGE", raising=False)
    resp = SimpleNamespace(
        model="gpt-4o",
        usage=SimpleNamespace(prompt_tokens=10, completion_tokens=5, total_tokens=15),
    )
    study_id = "LLM-LOG"
    with cost_usage.session(study_id, tmp_path, step="extract-deviations"):
        _log_chat_usage(resp, "my-deploy", "json", attempt=1, max_attempts=2, log_prefix="llm-usage")
    artifact = cost_usage.load_artifact(study_id, tmp_path)
    assert artifact["totals"]["llm"]["calls"] == 1
    assert artifact["totals"]["llm"]["total_tokens"] == 15
    assert artifact["events"][0]["label"] == "json"
    assert artifact["events"][0]["step"] == "extract-deviations"


def test_record_without_session_does_not_persist(tmp_path: Path):
    study_id = "NO-SESS"
    cost_usage.record_llm_usage(
        deployment="gpt-4o",
        model="gpt-4o",
        prompt_tokens=1,
        completion_tokens=1,
        total_tokens=2,
        label="x",
    )
    assert not local_pipeline_cost_usage_json(study_id, tmp_path).exists()


def test_ui_get_cost_usage(tmp_path: Path):
    from pdcheck_factory.ui_api.service import UiStepService

    service = UiStepService(output_dir=tmp_path)
    study_id = "COST-API"
    empty = service.get_cost_usage(study_id)
    assert empty["available"] is False
    assert empty["studyId"] == study_id

    with cost_usage.session(study_id, tmp_path, step="extract-inputs"):
        cost_usage.record_di_usage(doc_role="protocol", model_id="prebuilt-layout", pages=3)

    payload = service.get_cost_usage(study_id)
    assert payload["available"] is True
    assert payload["totals"]["document_intelligence"]["pages"] == 3
    assert payload["byStep"]["extract-inputs"]["document_intelligence"]["pages"] == 3
    assert payload["eventCount"] == 1

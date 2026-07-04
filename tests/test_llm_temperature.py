"""Tests for model-aware temperature handling in llm chat calls."""

from __future__ import annotations

import pytest

from pdcheck_factory import azure_openai_config, llm


def test_supports_temperature_for_gpt_and_o_series() -> None:
    assert azure_openai_config.supports_temperature("gpt-4o") is True
    assert azure_openai_config.supports_temperature("gpt-4.1") is True
    assert azure_openai_config.supports_temperature("o4-mini") is False
    assert azure_openai_config.supports_temperature("o1-preview") is False
    assert azure_openai_config.supports_temperature("o3-mini") is False


def test_chat_completion_kwargs_omits_temperature_for_reasoning_models(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        llm,
        "_model_name_for_deployment",
        lambda deployment_id: "o4-mini" if deployment_id == "o4-mini" else "gpt-4o",
    )
    assert llm._chat_completion_kwargs("o4-mini") == {}
    assert llm._chat_completion_kwargs("gpt-4o") == {"temperature": 0.0}


def test_model_name_for_deployment_uses_lookup(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        llm,
        "_deployment_model_lookup",
        {"my-gpt": "gpt-4o", "my-o4": "o4-mini"},
    )
    assert llm._model_name_for_deployment("my-gpt") == "gpt-4o"
    assert llm._model_name_for_deployment("unknown") == "unknown"

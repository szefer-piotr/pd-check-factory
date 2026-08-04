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


def test_prompt_size_stats_counts_roles() -> None:
    stats = llm._prompt_size_stats(
        [
            {"role": "system", "content": "abc"},
            {"role": "user", "content": "defgh"},
            {"role": "assistant", "content": "ij"},
            {"role": "user", "content": "kl"},
        ]
    )
    assert stats["messages"] == 4
    assert stats["system_chars"] == 3
    assert stats["user_chars"] == 7
    assert stats["assistant_chars"] == 2
    assert stats["total_chars"] == 12
    assert stats["approx_tokens"] == 3


def test_log_prompt_sizes_emits_monitor_line(monkeypatch: pytest.MonkeyPatch) -> None:
    lines: list[str] = []
    monkeypatch.setattr(llm, "_emit_llm_log", lines.append)
    llm._log_prompt_sizes(
        label="v2-rules",
        messages=[
            {"role": "system", "content": "sys"},
            {"role": "user", "content": "u" * 100},
        ],
        attempt=1,
        max_attempts=3,
    )
    assert len(lines) == 1
    assert "llm-prompt" in lines[0]
    assert "label='v2-rules'" in lines[0]
    assert "user_chars=100" in lines[0]
    assert "total_chars=103" in lines[0]
    assert "approx_tokens=25" in lines[0]

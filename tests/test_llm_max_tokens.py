"""Per-step max_tokens for Azure TPM, without clipping prompts or final output."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from pdcheck_factory import llm


def test_initial_max_output_tokens_by_label() -> None:
    assert llm.initial_max_output_tokens("v2-normalize-dev-1") == 1024
    assert llm.initial_max_output_tokens("v2-classify-dev-9") == 1024
    assert llm.initial_max_output_tokens("v2-dev-rule-003") == 4096
    assert llm.initial_max_output_tokens("v2-acrf-section-01") == 8192
    assert llm.initial_max_output_tokens("v2-rules") == llm.MODEL_MAX_OUTPUT_TOKENS
    assert llm.initial_max_output_tokens("unknown-step") == 4096


def test_initial_max_output_tokens_never_exceeds_model_max() -> None:
    assert llm.initial_max_output_tokens("v2-rules") <= llm.MODEL_MAX_OUTPUT_TOKENS
    assert llm.initial_max_output_tokens("step1-rules") <= llm.MODEL_MAX_OUTPUT_TOKENS


class _FakeMessage:
    def __init__(self, content: str, parsed: Any = None, refusal: str | None = None) -> None:
        self.content = content
        self.parsed = parsed
        self.refusal = refusal


class _FakeChoice:
    def __init__(self, content: str, finish_reason: str, parsed: Any = None) -> None:
        self.message = _FakeMessage(content, parsed=parsed)
        self.finish_reason = finish_reason


class _FakeResp:
    def __init__(self, content: str, finish_reason: str = "stop", parsed: Any = None) -> None:
        self.choices = [_FakeChoice(content, finish_reason, parsed=parsed)]
        self.usage = SimpleNamespace(prompt_tokens=10, completion_tokens=5, total_tokens=15)
        self.model = "gpt-4o"


def _patch_chat_client(monkeypatch: pytest.MonkeyPatch, create_fn: Any) -> list[dict[str, Any]]:
    created: list[dict[str, Any]] = []

    class FakeCompletions:
        def create(self, **kwargs: Any) -> Any:
            created.append(kwargs)
            return create_fn(kwargs)

    monkeypatch.setattr(
        llm,
        "_azure_client",
        lambda: SimpleNamespace(chat=SimpleNamespace(completions=FakeCompletions())),
    )
    monkeypatch.setattr(llm, "deployment_name", lambda: "gpt-4o")
    monkeypatch.setattr(llm, "_model_name_for_deployment", lambda _d: "gpt-4o")
    monkeypatch.setattr(llm, "load_prompt", lambda _name: "repair __ERROR__")
    monkeypatch.setattr(llm, "_record_chat_exchange", lambda **_k: None)
    monkeypatch.setattr(llm, "_log_chat_usage", lambda *_a, **_k: None)
    monkeypatch.setattr(llm, "_log_prompt_sizes", lambda **_k: None)
    return created


def test_chat_text_repairs_sends_per_step_max_tokens(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    created = _patch_chat_client(monkeypatch, lambda _kwargs: _FakeResp("ok"))
    prompt = "full protocol " * 50
    result = llm.chat_text_repairs(
        system="sys",
        user=prompt,
        validate_reply=lambda _t: None,
        label="v2-normalize-dev-1",
    )
    assert result == "ok"
    assert created[0]["max_tokens"] == 1024
    assert created[0]["messages"][1]["content"] == prompt


def test_chat_text_repairs_retries_at_model_max_if_truncated(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def create_fn(kwargs: dict[str, Any]) -> _FakeResp:
        if kwargs.get("max_tokens") == llm.MODEL_MAX_OUTPUT_TOKENS:
            return _FakeResp("complete reply", finish_reason="stop")
        return _FakeResp("cut off", finish_reason="length")

    created = _patch_chat_client(monkeypatch, create_fn)
    prompt = "do not clip this input"
    result = llm.chat_text_repairs(
        system="sys",
        user=prompt,
        validate_reply=lambda _t: None,
        label="v2-normalize-dev-1",
        max_repairs=0,
    )
    assert result == "complete reply"
    assert [call["max_tokens"] for call in created] == [1024, llm.MODEL_MAX_OUTPUT_TOKENS]
    assert created[0]["messages"][1]["content"] == prompt
    assert created[1]["messages"][1]["content"] == prompt
    assert created[1]["messages"] == created[0]["messages"]


def test_chat_json_sends_max_tokens_and_retries_if_truncated(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    parsed_ok = llm.PseudoLogicOutput(pseudo_logic="SELECT 1")
    calls: list[dict[str, Any]] = []

    class FakeParse:
        def parse(self, **kwargs: Any) -> Any:
            calls.append(kwargs)
            if kwargs.get("max_tokens") == llm.MODEL_MAX_OUTPUT_TOKENS:
                return _FakeResp("{}", finish_reason="stop", parsed=parsed_ok)
            return _FakeResp("{", finish_reason="length")

    monkeypatch.setattr(
        llm,
        "_azure_client",
        lambda: SimpleNamespace(
            beta=SimpleNamespace(chat=SimpleNamespace(completions=FakeParse()))
        ),
    )
    monkeypatch.setattr(llm, "deployment_name", lambda: "gpt-4o")
    monkeypatch.setattr(llm, "_model_name_for_deployment", lambda _d: "gpt-4o")
    monkeypatch.setattr(llm, "load_prompt", lambda _name: "repair")
    monkeypatch.setattr(llm, "_record_chat_exchange", lambda **_k: None)
    monkeypatch.setattr(llm, "_log_chat_usage", lambda *_a, **_k: None)
    monkeypatch.setattr(llm, "_log_prompt_sizes", lambda **_k: None)

    user = "keep this user prompt intact"
    out = llm.chat_json(
        system="sys",
        user=user,
        response_model=llm.PseudoLogicOutput,
        validator=lambda _d: [],
        label="generate-pseudo-logic",
        max_repairs=0,
    )
    assert out["pseudo_logic"] == "SELECT 1"
    assert [call["max_tokens"] for call in calls] == [4096, llm.MODEL_MAX_OUTPUT_TOKENS]
    assert calls[0]["messages"][1]["content"] == user
    assert calls[1]["messages"][1]["content"] == user

"""Tests for local full LLM call/response JSONL logging."""

from __future__ import annotations

import json
from pathlib import Path

from pdcheck_factory import cost_usage, llm_call_log, paths


def test_record_exchange_writes_jsonl_with_process_and_conversation(
    tmp_path: Path,
) -> None:
    study_id = "STUDY-LOG"
    with (
        cost_usage.session(study_id, tmp_path, step="review-chat"),
        llm_call_log.bind(
            process="review-chat.interpret",
            conversation_id=llm_call_log.conversation_id_for_review_chat(
                study_id, "dev-001"
            ),
        ),
    ):
        event = llm_call_log.record_exchange(
            api="chat.completions.parse",
            label="review-chat.interpret",
            deployment="gpt-test",
            messages=[
                {"role": "system", "content": "sys"},
                {"role": "user", "content": "hello user"},
            ],
            response_content='{"ok": true}',
            response_parsed={"ok": True},
            model="gpt-4o",
            prompt_tokens=10,
            completion_tokens=5,
            total_tokens=15,
            attempt=1,
            max_attempts=3,
            duration_ms=42.5,
        )

    assert event["process"] == "review-chat.interpret"
    assert event["conversation_id"] == "review-chat:STUDY-LOG:dev-001"
    assert event["study_id"] == study_id
    assert event["request_messages"][1]["content"] == "hello user"
    assert event["response_parsed"] == {"ok": True}

    log_path = paths.local_llm_call_log_jsonl(study_id, tmp_path)
    assert log_path.is_file()
    lines = [ln for ln in log_path.read_text(encoding="utf-8").splitlines() if ln.strip()]
    assert len(lines) == 1
    loaded = json.loads(lines[0])
    assert loaded["process"] == "review-chat.interpret"
    assert loaded["conversation_id"] == "review-chat:STUDY-LOG:dev-001"
    assert loaded["label"] == "review-chat.interpret"
    assert loaded["api"] == "chat.completions.parse"
    assert loaded["request_messages"][0]["role"] == "system"


def test_use_process_overrides_without_losing_conversation(tmp_path: Path) -> None:
    study_id = "STUDY-NEST"
    with (
        cost_usage.session(study_id, tmp_path, step="rules-chat"),
        llm_call_log.bind(
            process="rules-chat",
            conversation_id=llm_call_log.conversation_id_for_rules_chat(study_id),
        ),
    ):
        with llm_call_log.use_process("rules-chat.answer"):
            event = llm_call_log.record_exchange(
                api="chat.completions",
                label="rules-chat.answer",
                deployment="gpt-test",
                messages=[{"role": "user", "content": "q"}],
                response_content="a",
                attempt=1,
                max_attempts=1,
            )
    assert event["process"] == "rules-chat.answer"
    assert event["conversation_id"] == "rules-chat:STUDY-NEST"


def test_process_falls_back_to_cost_step(tmp_path: Path) -> None:
    study_id = "STUDY-FALLBACK"
    with cost_usage.session(study_id, tmp_path, step="extract-rules"):
        event = llm_call_log.record_exchange(
            api="chat.completions",
            label="v2-rules",
            deployment="gpt-test",
            messages=[{"role": "user", "content": "x"}],
            response_content="y",
        )
    assert event["process"] == "extract-rules"
    assert event["conversation_id"] == "extract-rules:STUDY-FALLBACK"


def test_conversation_id_helpers() -> None:
    assert llm_call_log.conversation_id_for_rules_chat("S1") == "rules-chat:S1"
    assert (
        llm_call_log.conversation_id_for_review_chat("S1", "dev-9")
        == "review-chat:S1:dev-9"
    )
    assert llm_call_log.conversation_id_for_pipeline("S1") == "pipeline:S1"
    assert (
        llm_call_log.conversation_id_for_pipeline("S1", "run-abc")
        == "pipeline:S1:run-abc"
    )

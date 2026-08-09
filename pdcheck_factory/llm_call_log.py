"""Full local JSONL logging for every Azure OpenAI chat request/response.

Each line is one LLM API exchange with flat columns suitable for table filtering
(process, conversation_id, study_id, label, …) plus full message payloads.
"""

from __future__ import annotations

import json
import threading
import uuid
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterator, List, Mapping, Optional, Sequence

from pdcheck_factory import paths

SCHEMA_VERSION = "1.0.0"

_write_lock = threading.Lock()


@dataclass(frozen=True)
class LlmLogBind:
    """Process / conversation identity for the current call stack."""

    process: str | None = None
    conversation_id: str | None = None


_bind: ContextVar[LlmLogBind] = ContextVar(
    "llm_call_log_bind", default=LlmLogBind()
)


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def current_bind() -> LlmLogBind:
    return _bind.get()


@contextmanager
def bind(
    *,
    process: str | None = None,
    conversation_id: str | None = None,
) -> Iterator[LlmLogBind]:
    """Set process name and/or conversation id for nested LLM calls."""
    prev = _bind.get()
    nxt = LlmLogBind(
        process=process if process is not None else prev.process,
        conversation_id=(
            conversation_id if conversation_id is not None else prev.conversation_id
        ),
    )
    token = _bind.set(nxt)
    try:
        yield nxt
    finally:
        _bind.reset(token)


@contextmanager
def use_process(process: str) -> Iterator[LlmLogBind]:
    """Override only the process name (keeps conversation_id)."""
    with bind(process=process) as ctx:
        yield ctx


def conversation_id_for_rules_chat(study_id: str) -> str:
    return f"rules-chat:{study_id}"


def conversation_id_for_review_chat(study_id: str, deviation_id: str) -> str:
    return f"review-chat:{study_id}:{deviation_id}"


def conversation_id_for_pipeline(study_id: str, run_id: str | None = None) -> str:
    if run_id:
        return f"pipeline:{study_id}:{run_id}"
    return f"pipeline:{study_id}"


def _messages_for_log(messages: Sequence[Mapping[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for message in messages:
        role = str(message.get("role") or "unknown")
        content = message.get("content")
        if content is None:
            content_str = ""
        elif isinstance(content, str):
            content_str = content
        else:
            content_str = json.dumps(content, ensure_ascii=False, default=str)
        out.append({"role": role, "content": content_str})
    return out


def resolve_destination() -> tuple[str | None, Path | None]:
    """Return (study_id, log_path) from the active cost session, if any."""
    try:
        from pdcheck_factory import cost_usage

        sess = cost_usage.current_session()
    except Exception:  # noqa: BLE001
        return None, None
    if sess is None:
        return None, None
    log_path = paths.local_llm_call_log_jsonl(sess.study_id, sess.output_dir)
    return sess.study_id, log_path


def resolve_process(label: str) -> str:
    bound = _bind.get()
    if bound.process and bound.process.strip():
        return bound.process.strip()
    try:
        from pdcheck_factory import cost_usage

        sess = cost_usage.current_session()
        if sess is not None and sess.step:
            return str(sess.step)
    except Exception:  # noqa: BLE001
        pass
    return label or "llm"


def resolve_conversation_id(study_id: str | None, process: str) -> str:
    bound = _bind.get()
    if bound.conversation_id and bound.conversation_id.strip():
        return bound.conversation_id.strip()
    if study_id:
        return f"{process}:{study_id}"
    return process


def new_call_id() -> str:
    return uuid.uuid4().hex[:16]


def record_exchange(
    *,
    api: str,
    label: str,
    deployment: str,
    messages: Sequence[Mapping[str, Any]],
    response_content: str | None = None,
    response_parsed: Any = None,
    model: str | None = None,
    prompt_tokens: int | None = None,
    completion_tokens: int | None = None,
    total_tokens: int | None = None,
    attempt: int | None = None,
    max_attempts: int | None = None,
    duration_ms: float | None = None,
    error: str | None = None,
    call_id: str | None = None,
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Append one full request/response record to the study JSONL log."""
    study_id, log_path = resolve_destination()
    process = resolve_process(label)
    conversation_id = resolve_conversation_id(study_id, process)
    cid = call_id or new_call_id()

    event: Dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "ts": _iso_now(),
        "call_id": cid,
        "study_id": study_id,
        "process": process,
        "conversation_id": conversation_id,
        "label": label,
        "api": api,
        "deployment": deployment,
        "model": model,
        "attempt": attempt,
        "max_attempts": max_attempts,
        "duration_ms": round(duration_ms, 2) if duration_ms is not None else None,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": total_tokens,
        "request_messages": _messages_for_log(messages),
        "response_content": response_content,
        "response_parsed": response_parsed,
        "error": error,
    }
    if extra:
        event["extra"] = extra

    summary = (
        f"[llm-call] call_id={cid} process={process!r} "
        f"conversation_id={conversation_id!r} label={label!r} "
        f"api={api!r} attempt={attempt}/{max_attempts} "
        f"duration_ms={event['duration_ms']} "
        f"tokens={total_tokens} error={error!r}"
    )
    print(summary)

    if log_path is None:
        return event

    line = json.dumps(event, ensure_ascii=False, default=str)
    with _write_lock:
        log_path.parent.mkdir(parents=True, exist_ok=True)
        with log_path.open("a", encoding="utf-8") as fh:
            fh.write(line + "\n")
    return event

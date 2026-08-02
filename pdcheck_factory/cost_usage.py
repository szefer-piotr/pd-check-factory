"""Structured cost usage logging for Azure OpenAI and Document Intelligence."""

from __future__ import annotations

import json
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional

from pdcheck_factory import paths, pricing
from pdcheck_factory.json_util import write_json

SCHEMA_VERSION = "1.0.0"
MAX_EVENTS = 5000


@dataclass(frozen=True)
class CostSession:
    study_id: str
    output_dir: Path
    step: str | None = None


_session: ContextVar[CostSession | None] = ContextVar("cost_usage_session", default=None)


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def current_session() -> CostSession | None:
    return _session.get()


@contextmanager
def session(
    study_id: str,
    output_dir: Path,
    *,
    step: str | None = None,
) -> Iterator[CostSession]:
    """Bind study context so LLM/DI calls persist into pipeline_cost_usage.json."""
    sess = CostSession(study_id=study_id, output_dir=Path(output_dir), step=step)
    token = _session.set(sess)
    try:
        yield sess
    finally:
        _session.reset(token)


@contextmanager
def use_step(step: str | None) -> Iterator[None]:
    """Temporarily override the step label within the current session."""
    current = _session.get()
    if current is None:
        yield
        return
    token = _session.set(
        CostSession(study_id=current.study_id, output_dir=current.output_dir, step=step)
    )
    try:
        yield
    finally:
        _session.reset(token)


def _empty_llm_totals() -> Dict[str, Any]:
    return {
        "calls": 0,
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "total_tokens": 0,
        "cost_usd": 0.0,
    }


def _empty_di_totals() -> Dict[str, Any]:
    return {"calls": 0, "pages": 0, "cost_usd": 0.0}


def empty_artifact(study_id: str, *, pricing_source: str = "defaults") -> Dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "study_id": study_id,
        "updated_at": _iso_now(),
        "pricing_source": pricing_source,
        "totals": {
            "llm": _empty_llm_totals(),
            "document_intelligence": _empty_di_totals(),
            "cost_usd": 0.0,
        },
        "by_step": {},
        "events": [],
    }


def load_artifact(study_id: str, output_dir: Path) -> Dict[str, Any]:
    path = paths.local_pipeline_cost_usage_json(study_id, output_dir)
    if not path.is_file():
        return empty_artifact(study_id)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return empty_artifact(study_id)
    if not isinstance(data, dict):
        return empty_artifact(study_id)
    data.setdefault("schema_version", SCHEMA_VERSION)
    data.setdefault("study_id", study_id)
    data.setdefault("totals", {})
    data["totals"].setdefault("llm", _empty_llm_totals())
    data["totals"].setdefault("document_intelligence", _empty_di_totals())
    data["totals"].setdefault("cost_usd", 0.0)
    data.setdefault("by_step", {})
    data.setdefault("events", [])
    return data


def _add_cost(current: Any, delta: Optional[float]) -> float:
    if delta is None:
        return float(current or 0.0)
    return round(float(current or 0.0) + float(delta), 8)


def _ensure_step_bucket(artifact: Dict[str, Any], step: str) -> Dict[str, Any]:
    by_step = artifact.setdefault("by_step", {})
    bucket = by_step.get(step)
    if not isinstance(bucket, dict):
        bucket = {
            "llm": _empty_llm_totals(),
            "document_intelligence": _empty_di_totals(),
            "cost_usd": 0.0,
        }
        by_step[step] = bucket
    bucket.setdefault("llm", _empty_llm_totals())
    bucket.setdefault("document_intelligence", _empty_di_totals())
    bucket.setdefault("cost_usd", 0.0)
    return bucket


def _apply_llm_to_bucket(bucket: Dict[str, Any], event: Dict[str, Any]) -> None:
    llm = bucket["llm"]
    llm["calls"] = int(llm.get("calls", 0)) + 1
    llm["prompt_tokens"] = int(llm.get("prompt_tokens", 0)) + int(event.get("prompt_tokens") or 0)
    llm["completion_tokens"] = int(llm.get("completion_tokens", 0)) + int(
        event.get("completion_tokens") or 0
    )
    llm["total_tokens"] = int(llm.get("total_tokens", 0)) + int(event.get("total_tokens") or 0)
    llm["cost_usd"] = _add_cost(llm.get("cost_usd"), event.get("cost_usd"))
    bucket["cost_usd"] = _add_cost(bucket.get("cost_usd"), event.get("cost_usd"))


def _apply_di_to_bucket(bucket: Dict[str, Any], event: Dict[str, Any]) -> None:
    di = bucket["document_intelligence"]
    di["calls"] = int(di.get("calls", 0)) + 1
    di["pages"] = int(di.get("pages", 0)) + int(event.get("pages") or 0)
    di["cost_usd"] = _add_cost(di.get("cost_usd"), event.get("cost_usd"))
    bucket["cost_usd"] = _add_cost(bucket.get("cost_usd"), event.get("cost_usd"))


def _recompute_grand_total(artifact: Dict[str, Any]) -> None:
    totals = artifact["totals"]
    llm_cost = float(totals["llm"].get("cost_usd") or 0.0)
    di_cost = float(totals["document_intelligence"].get("cost_usd") or 0.0)
    totals["cost_usd"] = round(llm_cost + di_cost, 8)


def _persist(artifact: Dict[str, Any], study_id: str, output_dir: Path) -> Path:
    artifact["updated_at"] = _iso_now()
    events = artifact.get("events")
    if isinstance(events, list) and len(events) > MAX_EVENTS:
        artifact["events"] = events[-MAX_EVENTS:]
    path = paths.local_pipeline_cost_usage_json(study_id, output_dir)
    write_json(path, artifact)
    try:
        from pdcheck_factory import study_artifact_sync

        study_artifact_sync.mirror_upload_path(study_id, output_dir, path)
    except Exception:  # noqa: BLE001
        pass
    return path


def print_cost_summary(artifact: Dict[str, Any]) -> None:
    totals = artifact.get("totals") or {}
    llm = totals.get("llm") or {}
    di = totals.get("document_intelligence") or {}
    print(
        "[cost-summary] "
        f"study={artifact.get('study_id')!r} "
        f"pricing_source={artifact.get('pricing_source')!r} "
        f"llm_calls={llm.get('calls', 0)} "
        f"prompt_tokens={llm.get('prompt_tokens', 0)} "
        f"completion_tokens={llm.get('completion_tokens', 0)} "
        f"llm_cost_usd={llm.get('cost_usd', 0.0)} "
        f"di_calls={di.get('calls', 0)} "
        f"di_pages={di.get('pages', 0)} "
        f"di_cost_usd={di.get('cost_usd', 0.0)} "
        f"total_cost_usd={totals.get('cost_usd', 0.0)}"
    )


def print_cost_breakdown(artifact: Dict[str, Any]) -> None:
    print_cost_summary(artifact)
    by_step = artifact.get("by_step") or {}
    if not by_step:
        print("[cost-summary] by_step=(empty)")
        return
    for step_name in sorted(by_step.keys()):
        bucket = by_step[step_name] or {}
        llm = bucket.get("llm") or {}
        di = bucket.get("document_intelligence") or {}
        print(
            f"[cost-step] step={step_name!r} "
            f"llm_calls={llm.get('calls', 0)} "
            f"tokens={llm.get('total_tokens', 0)} "
            f"llm_cost_usd={llm.get('cost_usd', 0.0)} "
            f"di_pages={di.get('pages', 0)} "
            f"di_cost_usd={di.get('cost_usd', 0.0)} "
            f"step_cost_usd={bucket.get('cost_usd', 0.0)}"
        )


def record_llm_usage(
    *,
    deployment: str,
    model: str | None,
    prompt_tokens: int | None,
    completion_tokens: int | None,
    total_tokens: int | None,
    label: str = "llm",
    attempt: int | None = None,
) -> Dict[str, Any]:
    """Record one LLM call. Persists when a cost session is active."""
    table = pricing.load_pricing_table()
    cost, rate_key = pricing.llm_cost_usd(
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        deployment=deployment,
        model=model,
        table=table,
    )
    prompt = int(prompt_tokens or 0)
    completion = int(completion_tokens or 0)
    total = int(total_tokens) if total_tokens is not None else prompt + completion

    sess = _session.get()
    step = (sess.step if sess else None) or label or "llm"
    event: Dict[str, Any] = {
        "ts": _iso_now(),
        "kind": "llm",
        "step": step,
        "label": label,
        "deployment": deployment,
        "model": model,
        "prompt_tokens": prompt,
        "completion_tokens": completion,
        "total_tokens": total,
        "cost_usd": cost,
        "rate_key": rate_key,
        "attempt": attempt,
    }

    if sess is None:
        return event

    artifact = load_artifact(sess.study_id, sess.output_dir)
    artifact["pricing_source"] = table.source
    _apply_llm_to_bucket(artifact["totals"], event)
    _apply_llm_to_bucket(_ensure_step_bucket(artifact, step), event)
    _recompute_grand_total(artifact)
    events: List[Any] = list(artifact.get("events") or [])
    events.append(event)
    artifact["events"] = events
    _persist(artifact, sess.study_id, sess.output_dir)
    print(
        f"[cost-llm] step={step!r} label={label!r} "
        f"prompt_tokens={prompt} completion_tokens={completion} "
        f"cost_usd={cost} running_total_usd={artifact['totals']['cost_usd']}"
    )
    return event


def record_di_usage(
    *,
    doc_role: str,
    model_id: str,
    pages: int,
) -> Dict[str, Any]:
    """Record one Document Intelligence Layout call."""
    table = pricing.load_pricing_table()
    cost, rate_key = pricing.di_cost_usd(pages=pages, model_id=model_id, table=table)
    sess = _session.get()
    step = (sess.step if sess else None) or f"di:{doc_role}"
    event: Dict[str, Any] = {
        "ts": _iso_now(),
        "kind": "document_intelligence",
        "step": step,
        "doc_role": doc_role,
        "model_id": model_id,
        "pages": int(pages),
        "cost_usd": cost,
        "rate_key": rate_key,
    }

    message = (
        f"[di-usage] doc_role={doc_role!r} model={model_id!r} "
        f"pages={pages} cost_usd={cost}"
    )
    print(message)

    if sess is None:
        return event

    artifact = load_artifact(sess.study_id, sess.output_dir)
    artifact["pricing_source"] = table.source
    _apply_di_to_bucket(artifact["totals"], event)
    _apply_di_to_bucket(_ensure_step_bucket(artifact, step), event)
    _recompute_grand_total(artifact)
    events: List[Any] = list(artifact.get("events") or [])
    events.append(event)
    artifact["events"] = events
    _persist(artifact, sess.study_id, sess.output_dir)
    print(
        f"[cost-di] step={step!r} pages={pages} cost_usd={cost} "
        f"running_total_usd={artifact['totals']['cost_usd']}"
    )
    return event


def di_page_count(result: Any, raw_dict: Dict[str, Any] | None = None) -> int:
    """Extract billable page count from a DI analyze result."""
    pages = getattr(result, "pages", None)
    if pages is not None:
        try:
            return len(pages)
        except TypeError:
            pass
    if isinstance(raw_dict, dict):
        raw_pages = raw_dict.get("pages")
        if isinstance(raw_pages, list):
            return len(raw_pages)
    return 0

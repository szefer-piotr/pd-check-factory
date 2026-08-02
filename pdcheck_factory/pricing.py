"""Estimated Azure OpenAI and Document Intelligence rates for cost analysis.

Rates are estimates for workflow analysis — not Azure invoice truth.
Override via COST_PRICING_FILE, COST_LLM_RATES_JSON, or COST_DI_USD_PER_PAGE.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Mapping, Optional, Tuple

# Approximate public Azure list prices (USD). Labels are estimates only.
_DEFAULT_LLM_RATES: Dict[str, Dict[str, float]] = {
    "default": {"prompt_usd_per_1m": 2.50, "completion_usd_per_1m": 10.00},
    "gpt-4o": {"prompt_usd_per_1m": 2.50, "completion_usd_per_1m": 10.00},
    "gpt-4o-mini": {"prompt_usd_per_1m": 0.15, "completion_usd_per_1m": 0.60},
    "gpt-4.1": {"prompt_usd_per_1m": 2.00, "completion_usd_per_1m": 8.00},
    "gpt-4.1-mini": {"prompt_usd_per_1m": 0.40, "completion_usd_per_1m": 1.60},
    "gpt-4.1-nano": {"prompt_usd_per_1m": 0.10, "completion_usd_per_1m": 0.40},
    "o1": {"prompt_usd_per_1m": 15.00, "completion_usd_per_1m": 60.00},
    "o3": {"prompt_usd_per_1m": 10.00, "completion_usd_per_1m": 40.00},
    "o3-mini": {"prompt_usd_per_1m": 1.10, "completion_usd_per_1m": 4.40},
    "o4-mini": {"prompt_usd_per_1m": 1.10, "completion_usd_per_1m": 4.40},
}

# Azure Document Intelligence prebuilt-layout ~$10 / 1,000 pages.
_DEFAULT_DI_USD_PER_PAGE = 0.01
_DEFAULT_DI_RATES: Dict[str, float] = {
    "default": _DEFAULT_DI_USD_PER_PAGE,
    "prebuilt-layout": _DEFAULT_DI_USD_PER_PAGE,
}


@dataclass(frozen=True)
class LlmRate:
    prompt_usd_per_1m: float
    completion_usd_per_1m: float
    matched_key: str


@dataclass(frozen=True)
class PricingTable:
    llm_rates: Dict[str, Dict[str, float]]
    di_rates: Dict[str, float]
    source: str  # defaults | env | file


def _normalize_key(name: str) -> str:
    return (name or "").strip().lower()


def _family_prefix(model_name: str) -> Optional[str]:
    """Best-effort model family key from a deployment or model string."""
    normalized = _normalize_key(model_name)
    if not normalized:
        return None
    # Prefer longer known keys first.
    known = sorted(
        (k for k in _DEFAULT_LLM_RATES if k != "default"),
        key=len,
        reverse=True,
    )
    for key in known:
        if normalized == key or normalized.startswith(key):
            return key
    # Strip trailing date/version suffixes: gpt-4o-2024-08-06
    parts = normalized.split("-")
    for length in range(len(parts), 0, -1):
        candidate = "-".join(parts[:length])
        if candidate in _DEFAULT_LLM_RATES and candidate != "default":
            return candidate
    return None


def _parse_llm_rate_entry(value: Any) -> Optional[Dict[str, float]]:
    if not isinstance(value, Mapping):
        return None
    try:
        prompt = float(value["prompt_usd_per_1m"])
        completion = float(value["completion_usd_per_1m"])
    except (KeyError, TypeError, ValueError):
        return None
    return {"prompt_usd_per_1m": prompt, "completion_usd_per_1m": completion}


def _merge_llm_rates(
    base: Mapping[str, Dict[str, float]],
    overrides: Mapping[str, Any],
) -> Dict[str, Dict[str, float]]:
    merged = {k: dict(v) for k, v in base.items()}
    for key, raw in overrides.items():
        parsed = _parse_llm_rate_entry(raw)
        if parsed is None:
            continue
        merged[_normalize_key(str(key))] = parsed
    return merged


def _merge_di_rates(base: Mapping[str, float], overrides: Mapping[str, Any]) -> Dict[str, float]:
    merged = {k: float(v) for k, v in base.items()}
    for key, raw in overrides.items():
        try:
            merged[_normalize_key(str(key))] = float(raw)
        except (TypeError, ValueError):
            continue
    return merged


def load_pricing_table() -> PricingTable:
    """Load rates from defaults, optional file, then env overlays."""
    llm_rates = {k: dict(v) for k, v in _DEFAULT_LLM_RATES.items()}
    di_rates = dict(_DEFAULT_DI_RATES)
    source = "defaults"

    pricing_file = (os.getenv("COST_PRICING_FILE") or "").strip()
    if pricing_file:
        path = Path(pricing_file)
        if path.is_file():
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                payload = None
            if isinstance(payload, dict):
                llm_raw = payload.get("llm") or payload.get("llm_rates") or {}
                di_raw = payload.get("document_intelligence") or payload.get("di_rates") or {}
                if isinstance(llm_raw, Mapping):
                    llm_rates = _merge_llm_rates(llm_rates, llm_raw)
                if isinstance(di_raw, Mapping):
                    di_rates = _merge_di_rates(di_rates, di_raw)
                source = "file"

    llm_json = (os.getenv("COST_LLM_RATES_JSON") or "").strip()
    if llm_json:
        try:
            parsed = json.loads(llm_json)
        except json.JSONDecodeError:
            parsed = None
        if isinstance(parsed, dict):
            llm_rates = _merge_llm_rates(llm_rates, parsed)
            source = "env"

    di_page = (os.getenv("COST_DI_USD_PER_PAGE") or "").strip()
    if di_page:
        try:
            rate = float(di_page)
            di_rates["default"] = rate
            di_rates["prebuilt-layout"] = rate
            source = "env"
        except ValueError:
            pass

    return PricingTable(llm_rates=llm_rates, di_rates=di_rates, source=source)


def lookup_llm_rate(
    *,
    deployment: str | None = None,
    model: str | None = None,
    table: PricingTable | None = None,
) -> Optional[LlmRate]:
    """Resolve LLM rates: deployment → model → family → default → None."""
    pricing = table or load_pricing_table()
    rates = pricing.llm_rates

    candidates: list[str] = []
    for raw in (deployment, model):
        key = _normalize_key(raw or "")
        if key and key not in candidates:
            candidates.append(key)
        family = _family_prefix(raw or "")
        if family and family not in candidates:
            candidates.append(family)

    for key in candidates:
        entry = rates.get(key)
        if entry:
            return LlmRate(
                prompt_usd_per_1m=float(entry["prompt_usd_per_1m"]),
                completion_usd_per_1m=float(entry["completion_usd_per_1m"]),
                matched_key=key,
            )

    default = rates.get("default")
    if default:
        return LlmRate(
            prompt_usd_per_1m=float(default["prompt_usd_per_1m"]),
            completion_usd_per_1m=float(default["completion_usd_per_1m"]),
            matched_key="default",
        )
    return None


def llm_cost_usd(
    *,
    prompt_tokens: int | None,
    completion_tokens: int | None,
    deployment: str | None = None,
    model: str | None = None,
    table: PricingTable | None = None,
) -> Tuple[Optional[float], Optional[str]]:
    """Return (cost_usd, matched_rate_key). cost_usd is None when rate missing."""
    rate = lookup_llm_rate(deployment=deployment, model=model, table=table)
    if rate is None:
        return None, None
    prompt = int(prompt_tokens or 0)
    completion = int(completion_tokens or 0)
    cost = (prompt / 1_000_000.0) * rate.prompt_usd_per_1m + (
        completion / 1_000_000.0
    ) * rate.completion_usd_per_1m
    return round(cost, 8), rate.matched_key


def lookup_di_usd_per_page(
    *,
    model_id: str | None = None,
    table: PricingTable | None = None,
) -> Optional[Tuple[float, str]]:
    pricing = table or load_pricing_table()
    key = _normalize_key(model_id or "") or "default"
    if key in pricing.di_rates:
        return float(pricing.di_rates[key]), key
    if "default" in pricing.di_rates:
        return float(pricing.di_rates["default"]), "default"
    return None


def di_cost_usd(
    *,
    pages: int,
    model_id: str | None = None,
    table: PricingTable | None = None,
) -> Tuple[Optional[float], Optional[str]]:
    looked = lookup_di_usd_per_page(model_id=model_id, table=table)
    if looked is None:
        return None, None
    rate, matched = looked
    return round(max(0, int(pages)) * rate, 8), matched

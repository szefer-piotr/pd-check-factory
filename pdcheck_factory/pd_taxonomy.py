"""Load and validate PD category/sub-category taxonomy from bundled JSON."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Dict, List, Optional, Tuple

_DATA_DIR = Path(__file__).resolve().parent / "data"
_TAXONOMY_PATH = _DATA_DIR / "pd_category_subcategory.json"
_TEMPLATE_META_PATH = _DATA_DIR / "pd_spec_template_meta.json"

VISIT_WINDOW_SUB_CATEGORIES = frozenset(
    {
        "Study Visit Out of Window",
        "Study Visit Missed",
        "Study Procedure Out of Window",
        "Study Procedure Missed",
        "IP dose taken Out of Window",
        "AE reported out of window",
        "SAE reported out of window",
    }
)


def _normalize(value: str) -> str:
    return " ".join(str(value or "").strip().split())


@lru_cache(maxsize=1)
def load_taxonomy() -> Dict[str, List[str]]:
    raw = json.loads(_TAXONOMY_PATH.read_text(encoding="utf-8"))
    categories = raw.get("categories", {})
    return {str(k): [str(s) for s in v] for k, v in categories.items()}


@lru_cache(maxsize=1)
def load_template_meta() -> Dict:
    return json.loads(_TEMPLATE_META_PATH.read_text(encoding="utf-8"))


def category_options() -> List[str]:
    return list(load_taxonomy().keys())


def all_sub_category_options() -> List[str]:
    meta = load_template_meta()
    options = meta.get("sub_category_options")
    if isinstance(options, list) and options:
        return [str(x) for x in options]
    seen: List[str] = []
    for subs in load_taxonomy().values():
        for sub in subs:
            if sub not in seen:
                seen.append(sub)
    return seen


def sub_categories_for(category: str) -> List[str]:
    return list(load_taxonomy().get(_normalize(category), []))


def validate_category(category: str) -> bool:
    if not _normalize(category):
        return True
    return _normalize(category) in load_taxonomy()


def validate_sub_category(category: str, sub_category: str) -> bool:
    cat = _normalize(category)
    sub = _normalize(sub_category)
    if not cat and not sub:
        return True
    if not cat or not sub:
        return False
    return sub in {_normalize(s) for s in load_taxonomy().get(cat, [])}


def normalize_category_pair(category: str, sub_category: str) -> Tuple[str, str]:
    """Return validated (category, sub_category) or blank both if invalid."""
    cat = _normalize(category)
    sub = _normalize(sub_category)
    if not cat and not sub:
        return "", ""
    if not validate_category(cat):
        return "", ""
    if not validate_sub_category(cat, sub):
        return "", ""
    taxonomy = load_taxonomy()
    canonical_cat = next((k for k in taxonomy if _normalize(k) == cat), cat)
    canonical_sub = next((s for s in taxonomy[canonical_cat] if _normalize(s) == sub), sub)
    return canonical_cat, canonical_sub


def taxonomy_prompt_text() -> str:
    lines: List[str] = []
    for category, subs in load_taxonomy().items():
        lines.append(f"{category}:")
        for sub in subs:
            lines.append(f"  - {sub}")
    return "\n".join(lines)


def programming_status_options() -> List[str]:
    meta = load_template_meta()
    options = meta.get("programming_status_options")
    if isinstance(options, list) and options:
        return [str(x) for x in options]
    return []


def export_headers() -> List[str]:
    meta = load_template_meta()
    headers = meta.get("export_headers")
    if isinstance(headers, list) and headers:
        return [str(h) for h in headers]
    return []


def find_category_for_sub_category(sub_category: str) -> Optional[str]:
    sub = _normalize(sub_category)
    if not sub:
        return None
    for category, subs in load_taxonomy().items():
        if any(_normalize(s) == sub for s in subs):
            return category
    return None

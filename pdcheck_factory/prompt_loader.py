"""Load LLM prompt templates shipped with the package (Markdown under prompts/)."""

from __future__ import annotations

from functools import lru_cache
from importlib.resources import files


@lru_cache(maxsize=32)
def load_prompt(stem: str) -> str:
    """Return the text of ``prompts/<stem>.md`` (UTF-8), stripped of leading/trailing whitespace."""
    path = files("pdcheck_factory").joinpath("prompts", f"{stem}.md")
    return path.read_text(encoding="utf-8").strip()

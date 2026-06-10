"""JSON Schema validation and LLM JSON repair loop."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, List, Tuple, TypeVar

from jsonschema import Draft202012Validator

T = TypeVar("T")


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def try_read_json(path: Path, default: T) -> T:
    """Read JSON from ``path``, returning ``default`` when missing, empty, or invalid."""
    if not path.is_file():
        return default
    try:
        raw = path.read_text(encoding="utf-8").strip()
        if not raw:
            return default
        return json.loads(raw)
    except (json.JSONDecodeError, OSError, UnicodeError, TypeError):
        return default


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(data, ensure_ascii=False, indent=2)
    tmp = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    try:
        tmp.write_text(text, encoding="utf-8")
        os.replace(tmp, path)
    finally:
        if tmp.is_file():
            tmp.unlink(missing_ok=True)


def validate(instance: Any, schema: Dict[str, Any]) -> List[str]:
    validator = Draft202012Validator(schema)
    errors = sorted(validator.iter_errors(instance), key=lambda e: e.path)
    return [e.message for e in errors]


def project_root() -> Path:
    return Path(__file__).resolve().parent.parent


def load_schema(name: str) -> Dict[str, Any]:
    path = project_root() / "schemas" / name
    return read_json(path)


def parse_json_object(raw: str) -> Dict[str, Any]:
    raw = raw.strip()
    if not raw:
        raise ValueError("Empty model response.")
    return json.loads(raw)

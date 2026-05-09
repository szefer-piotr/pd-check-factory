"""Resolve protocol/aCRF rendered markdown paths based on UI extractor choice."""

from __future__ import annotations

from pathlib import Path
from typing import Optional

from pdcheck_factory import paths
from pdcheck_factory.json_util import read_json, write_json

UI_EXTRACTOR_OPEN = "opendataloader"
UI_EXTRACTOR_DI = "document_intelligence"
UI_EXTRACTOR_BOTH = "both"

VALID_UI_EXTRACTORS = frozenset({UI_EXTRACTOR_OPEN, UI_EXTRACTOR_DI, UI_EXTRACTOR_BOTH})


def local_ui_extractor_choice_json(study_id: str, output_dir: Path) -> Path:
    return paths.local_study_root(study_id, output_dir) / "extractions" / "ui_extractor_choice.json"


def write_ui_extractor_choice(study_id: str, output_dir: Path, extractor: str) -> None:
    path = local_ui_extractor_choice_json(study_id, output_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    write_json(path, {"schema_version": "1.0.0", "extractor": extractor})


def read_ui_extractor_choice(study_id: str, output_dir: Path) -> Optional[str]:
    path = local_ui_extractor_choice_json(study_id, output_dir)
    if not path.is_file():
        return None
    data = read_json(path)
    raw = str(data.get("extractor", "")).strip()
    return raw or None


def _protocol_odl_md(study_id: str, output_dir: Path) -> Path:
    return paths.local_extraction_opendataloader(study_id, "protocol", output_dir) / "rendered" / "source.md"


def _protocol_di_md(study_id: str, output_dir: Path) -> Path:
    return paths.local_extraction_layout(study_id, "protocol", output_dir) / "rendered" / "source.md"


def _acrf_odl_md(study_id: str, output_dir: Path) -> Path:
    return paths.local_extraction_opendataloader(study_id, "acrf", output_dir) / "rendered" / "source.md"


def _acrf_di_md(study_id: str, output_dir: Path) -> Path:
    return paths.local_extraction_layout(study_id, "acrf", output_dir) / "rendered" / "source.md"


def resolve_protocol_rendered_source_md(study_id: str, output_dir: Path) -> Path:
    choice = read_ui_extractor_choice(study_id, output_dir)
    odl = _protocol_odl_md(study_id, output_dir)
    di = _protocol_di_md(study_id, output_dir)
    if choice == UI_EXTRACTOR_OPEN:
        return odl
    if choice == UI_EXTRACTOR_DI:
        return di
    # "both" or no file: prefer OpenDataLoader when present (previous UI default preview).
    if odl.is_file():
        return odl
    return di


def resolve_acrf_rendered_source_md(study_id: str, output_dir: Path) -> Path:
    choice = read_ui_extractor_choice(study_id, output_dir)
    odl = _acrf_odl_md(study_id, output_dir)
    di = _acrf_di_md(study_id, output_dir)
    if choice == UI_EXTRACTOR_OPEN:
        return odl
    if choice == UI_EXTRACTOR_DI:
        return di
    # "both" or no file: prefer layout (Document Intelligence) for aCRF TOC pipeline.
    if di.is_file():
        return di
    return odl


def resolve_acrf_sections_toc_dir(study_id: str, output_dir: Path) -> Path:
    return resolve_acrf_rendered_source_md(study_id, output_dir).parent / "sections_toc"

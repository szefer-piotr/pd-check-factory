"""Resolve protocol/aCRF rendered markdown paths based on UI extractor choice."""

from __future__ import annotations

from pathlib import Path
from typing import Optional, Tuple

from pdcheck_factory import paths
from pdcheck_factory.json_util import read_json, write_json

UI_EXTRACTOR_OPEN = "opendataloader"
UI_EXTRACTOR_DI = "document_intelligence"
UI_EXTRACTOR_BOTH = "both"

VALID_UI_EXTRACTORS = frozenset({UI_EXTRACTOR_OPEN, UI_EXTRACTOR_DI, UI_EXTRACTOR_BOTH})
VALID_DOCUMENT_EXTRACTORS = frozenset({UI_EXTRACTOR_OPEN, UI_EXTRACTOR_DI})


def local_ui_extractor_choice_json(study_id: str, output_dir: Path) -> Path:
    return paths.local_study_root(study_id, output_dir) / "extractions" / "ui_extractor_choice.json"


def write_ui_extractor_choices(
    study_id: str,
    output_dir: Path,
    protocol: str,
    acrf: str,
) -> None:
    path = local_ui_extractor_choice_json(study_id, output_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    write_json(
        path,
        {
            "schema_version": "2.0.0",
            "protocol": protocol,
            "acrf": acrf,
        },
    )


def write_ui_extractor_choice(study_id: str, output_dir: Path, extractor: str) -> None:
    if extractor == UI_EXTRACTOR_BOTH:
        write_ui_extractor_choices(study_id, output_dir, UI_EXTRACTOR_OPEN, UI_EXTRACTOR_DI)
        return
    write_ui_extractor_choices(study_id, output_dir, extractor, extractor)


def _read_choice_data(study_id: str, output_dir: Path) -> dict:
    path = local_ui_extractor_choice_json(study_id, output_dir)
    if not path.is_file():
        return {}
    return read_json(path)


def read_ui_extractor_choices(study_id: str, output_dir: Path) -> Tuple[str, str]:
    data = _read_choice_data(study_id, output_dir)
    if str(data.get("schema_version", "")).strip() == "2.0.0":
        protocol = str(data.get("protocol", "")).strip()
        acrf = str(data.get("acrf", "")).strip()
        if protocol in VALID_DOCUMENT_EXTRACTORS and acrf in VALID_DOCUMENT_EXTRACTORS:
            return protocol, acrf
    legacy = str(data.get("extractor", "")).strip()
    if legacy == UI_EXTRACTOR_BOTH:
        return UI_EXTRACTOR_OPEN, UI_EXTRACTOR_DI
    if legacy in VALID_DOCUMENT_EXTRACTORS:
        return legacy, legacy
    return UI_EXTRACTOR_OPEN, UI_EXTRACTOR_DI


def read_ui_extractor_choice(study_id: str, output_dir: Path) -> Optional[str]:
    data = _read_choice_data(study_id, output_dir)
    if str(data.get("schema_version", "")).strip() == "2.0.0":
        protocol, acrf = read_ui_extractor_choices(study_id, output_dir)
        if protocol == acrf:
            return protocol
        return None
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
    choice, _acrf = read_ui_extractor_choices(study_id, output_dir)
    odl = _protocol_odl_md(study_id, output_dir)
    di = _protocol_di_md(study_id, output_dir)
    if choice == UI_EXTRACTOR_OPEN:
        return odl
    if choice == UI_EXTRACTOR_DI:
        return di
    if odl.is_file():
        return odl
    return di


def resolve_acrf_rendered_source_md(study_id: str, output_dir: Path) -> Path:
    _protocol, choice = read_ui_extractor_choices(study_id, output_dir)
    odl = _acrf_odl_md(study_id, output_dir)
    di = _acrf_di_md(study_id, output_dir)
    if choice == UI_EXTRACTOR_OPEN:
        return odl
    if choice == UI_EXTRACTOR_DI:
        return di
    if di.is_file():
        return di
    return odl


def resolve_acrf_sections_toc_dir(study_id: str, output_dir: Path) -> Path:
    return resolve_acrf_rendered_source_md(study_id, output_dir).parent / "sections_toc"

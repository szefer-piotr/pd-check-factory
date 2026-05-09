from __future__ import annotations

from pathlib import Path

from pdcheck_factory import extraction_resolve, paths


def _touch(path: Path, text: str = "x") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def test_resolve_protocol_explicit_opendataloader(tmp_path: Path) -> None:
    study_id = "S1"
    odl = paths.local_extraction_opendataloader(study_id, "protocol", tmp_path) / "rendered" / "source.md"
    di = paths.local_extraction_layout(study_id, "protocol", tmp_path) / "rendered" / "source.md"
    _touch(odl, "# odl")
    _touch(di, "# di")
    extraction_resolve.write_ui_extractor_choice(study_id, tmp_path, extraction_resolve.UI_EXTRACTOR_OPEN)
    assert extraction_resolve.resolve_protocol_rendered_source_md(study_id, tmp_path) == odl


def test_resolve_protocol_explicit_document_intelligence(tmp_path: Path) -> None:
    study_id = "S1"
    odl = paths.local_extraction_opendataloader(study_id, "protocol", tmp_path) / "rendered" / "source.md"
    di = paths.local_extraction_layout(study_id, "protocol", tmp_path) / "rendered" / "source.md"
    _touch(odl, "# odl")
    _touch(di, "# di")
    extraction_resolve.write_ui_extractor_choice(study_id, tmp_path, extraction_resolve.UI_EXTRACTOR_DI)
    assert extraction_resolve.resolve_protocol_rendered_source_md(study_id, tmp_path) == di


def test_resolve_protocol_legacy_prefers_opendataloader_when_present(tmp_path: Path) -> None:
    study_id = "S1"
    odl = paths.local_extraction_opendataloader(study_id, "protocol", tmp_path) / "rendered" / "source.md"
    di = paths.local_extraction_layout(study_id, "protocol", tmp_path) / "rendered" / "source.md"
    _touch(odl, "# odl")
    _touch(di, "# di")
    assert extraction_resolve.resolve_protocol_rendered_source_md(study_id, tmp_path) == odl


def test_resolve_acrf_legacy_prefers_layout_when_present(tmp_path: Path) -> None:
    study_id = "S1"
    odl = paths.local_extraction_opendataloader(study_id, "acrf", tmp_path) / "rendered" / "source.md"
    di = paths.local_extraction_layout(study_id, "acrf", tmp_path) / "rendered" / "source.md"
    _touch(odl, "# odl")
    _touch(di, "# di")
    assert extraction_resolve.resolve_acrf_rendered_source_md(study_id, tmp_path) == di


def test_resolve_acrf_explicit_opendataloader(tmp_path: Path) -> None:
    study_id = "S1"
    odl = paths.local_extraction_opendataloader(study_id, "acrf", tmp_path) / "rendered" / "source.md"
    di = paths.local_extraction_layout(study_id, "acrf", tmp_path) / "rendered" / "source.md"
    _touch(odl, "# odl")
    _touch(di, "# di")
    extraction_resolve.write_ui_extractor_choice(study_id, tmp_path, extraction_resolve.UI_EXTRACTOR_OPEN)
    assert extraction_resolve.resolve_acrf_rendered_source_md(study_id, tmp_path) == odl


def test_sections_toc_dir_follows_acrf_resolution(tmp_path: Path) -> None:
    study_id = "S1"
    odl = paths.local_extraction_opendataloader(study_id, "acrf", tmp_path) / "rendered" / "source.md"
    _touch(odl, "# odl")
    extraction_resolve.write_ui_extractor_choice(study_id, tmp_path, extraction_resolve.UI_EXTRACTOR_OPEN)
    expected = odl.parent / "sections_toc"
    assert extraction_resolve.resolve_acrf_sections_toc_dir(study_id, tmp_path) == expected

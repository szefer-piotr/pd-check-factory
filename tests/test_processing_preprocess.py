"""Tests for background preprocess endpoints and PD spec map import."""

from __future__ import annotations

import json
from io import BytesIO
from pathlib import Path

import pytest
from openpyxl import Workbook

from pdcheck_factory import blob_io, paths, pipeline_v2
from pdcheck_factory.json_util import read_json
from pdcheck_factory.pd_spec_export import PD_SPEC_HEADERS, PD_SPEC_SHEET_TITLE
from pdcheck_factory.ui_api.service import ENTRY_MODE_IMPORTED_PD_SPEC, UiStepService


def _minimal_pd_spec_xlsx() -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = PD_SPEC_SHEET_TITLE
    ws.append(PD_SPEC_HEADERS)
    ws.append(
        [
            "Eligibility Criteria",
            "Age",
            "Subject enrolled below minimum age",
            "",
            "Major",
            "Programmable",
            "",
            "",
            "RAVE",
            "",
            "",
            "",
            "",
        ]
    )
    buffer = BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


def test_import_pd_spec_map_writes_review_state(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    study_id = "MAP-TEST"
    workbook = paths.local_pd_spec_workbook(study_id, tmp_path)
    workbook.parent.mkdir(parents=True, exist_ok=True)
    workbook.write_bytes(_minimal_pd_spec_xlsx())
    mirrored: list[str] = []
    monkeypatch.setattr(
        pipeline_v2.study_artifact_sync,
        "mirror_upload_path",
        lambda _sid, _out, path: mirrored.append(str(path)),
    )

    result = pipeline_v2.run_import_pd_spec_map(study_id, tmp_path, pd_spec_import_mode="map")
    assert result["import_version"]
    assert len(result["deviations"]) == 1

    review_path = paths.local_deviations_review_state(study_id, tmp_path)
    assert review_path.is_file()
    review_obj = read_json(review_path)
    assert len(review_obj["deviations"]) == 1
    assert review_obj["deviations"][0]["entry_source"] == "imported_pd_spec"


def test_run_step_import_pd_spec_map_sets_entry_mode(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    service = UiStepService(output_dir=tmp_path)
    study_id = "MAP-STEP"
    workbook = paths.local_pd_spec_workbook(study_id, tmp_path)
    workbook.parent.mkdir(parents=True, exist_ok=True)
    workbook.write_bytes(_minimal_pd_spec_xlsx())
    monkeypatch.setattr(service, "_read_pd_spec_workbook_bytes", lambda _sid: _minimal_pd_spec_xlsx())
    monkeypatch.setattr(blob_io, "blob_service_from_env", lambda: object())
    monkeypatch.setattr(blob_io, "container_from_env", lambda: "container")
    monkeypatch.setattr(blob_io, "upload_blob_bytes", lambda **_kwargs: None)

    result = service.run_step(study_id, "import-pd-spec-map")
    assert "Mapped" in result["summary"]
    manifest = service._read_upload_manifest_obj(study_id)
    assert manifest["entryMode"] == ENTRY_MODE_IMPORTED_PD_SPEC
    assert manifest["pdSpecImportMode"] == "map"


def test_run_step_import_pd_spec_enrich_stub(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    service = UiStepService(output_dir=tmp_path)
    study_id = "ENRICH-STEP"
    monkeypatch.setattr(service, "_read_pd_spec_workbook_bytes", lambda _sid: _minimal_pd_spec_xlsx())
    monkeypatch.setattr(blob_io, "blob_service_from_env", lambda: object())
    monkeypatch.setattr(blob_io, "container_from_env", lambda: "container")
    monkeypatch.setattr(blob_io, "upload_blob_bytes", lambda **_kwargs: None)

    result = service.run_step(study_id, "import-pd-spec-enrich")
    assert "enrich preview" in result["summary"].lower()
    manifest = service._read_upload_manifest_obj(study_id)
    assert manifest["pdSpecImportMode"] == "enrich_stub"


def test_upload_status_includes_preprocess_flags(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    service = UiStepService(output_dir=tmp_path)
    study_id = "STATUS-FLAGS"
    index_path = paths.local_protocol_paragraph_index_json(study_id, tmp_path)
    index_path.parent.mkdir(parents=True, exist_ok=True)
    index_path.write_text('{"paragraphs": []}', encoding="utf-8")
    summary_path = paths.local_acrf_summary_text_merged(study_id, tmp_path)
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.write_text('{"datasets": []}', encoding="utf-8")

    monkeypatch.setattr(service, "_blob_has_upload", lambda _sid, role: True)
    monkeypatch.setattr(service, "_blob_has_pd_spec_workbook", lambda _sid: True)

    status = service.get_step1_upload_status(study_id)
    assert status["protocolPreprocessed"] is True
    assert status["acrfPreprocessed"] is True
    assert status["allThreeUploaded"] is True


def test_preprocess_protocol_indexes(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    service = UiStepService(output_dir=tmp_path)
    study_id = "PREPROTO"
    proto_md = paths.local_extraction_layout(study_id, "protocol", tmp_path) / "rendered" / "source.md"
    proto_md.parent.mkdir(parents=True, exist_ok=True)
    proto_md.write_text("# Protocol\n\nParagraph one.", encoding="utf-8")

    monkeypatch.setattr(service, "_assert_protocol_upload_ready", lambda _sid: None)
    monkeypatch.setattr(service, "_run_partial_extract", lambda *_a, **_k: None)

    result = service.preprocess_protocol(study_id)
    assert "Protocol" in result["message"]
    index_path = paths.local_protocol_paragraph_index_json(study_id, tmp_path)
    assert index_path.is_file()

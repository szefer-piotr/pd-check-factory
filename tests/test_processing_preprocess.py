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
    assert review_obj["deviations"][0]["pd_spec_import"]["entry_source"] == "imported_pd_spec"
    assert review_obj["pd_spec_import_mode"] == "map"


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
    assert manifest["reviewDisplaySource"] == "imported_pd_spec"


def test_run_step_import_pd_spec_enrich(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    service = UiStepService(output_dir=tmp_path)
    study_id = "ENRICH-STEP"
    index_path = paths.local_protocol_paragraph_index_json(study_id, tmp_path)
    index_path.parent.mkdir(parents=True, exist_ok=True)
    index_path.write_text(
        json.dumps({"paragraphs": [{"paragraph_id": "p1", "text": "Protocol rule"}]}),
        encoding="utf-8",
    )
    acrf_path = paths.local_acrf_summary_text_merged(study_id, tmp_path)
    acrf_path.parent.mkdir(parents=True, exist_ok=True)
    acrf_path.write_text('{"datasets":[]}', encoding="utf-8")
    dictionary_path = paths.local_acrf_field_dictionary_json(study_id, tmp_path)
    dictionary_path.write_text('{"datasets": [], "field_index": {}}', encoding="utf-8")

    monkeypatch.setattr(service, "_read_pd_spec_workbook_bytes", lambda _sid: _minimal_pd_spec_xlsx())
    monkeypatch.setattr(blob_io, "blob_service_from_env", lambda: object())
    monkeypatch.setattr(blob_io, "container_from_env", lambda: "container")
    monkeypatch.setattr(blob_io, "upload_blob_bytes", lambda **_kwargs: None)

    from pdcheck_factory.protocol_enrichment import EnrichmentProposalOutput

    def fake_chat_text_repairs(**_kwargs):  # type: ignore[no-untyped-def]
        label = str(_kwargs.get("label", ""))
        if "ground-protocol" in label:
            return (
                "<<<BEGIN_GROUNDING>>>\nPARAGRAPH_REFS: p1\n"
                "DATA_SUPPORT_NOTE: note\n<<<END_GROUNDING>>>"
            )
        return (
            "<<<BEGIN_ACRF_GROUNDING>>>\n"
            "PSEUDO_LOGIC_PLAIN_ENGLISH: logic\nPROGRAMMABLE: yes\n"
            "PROGRAMMABILITY_RISK: low\nPROGRAMMABILITY_RATIONALE: ok\n"
            "ACRF_SECTIONS: SV\nDATA_SUPPORT_NOTE: note\n<<<END_ACRF_GROUNDING>>>"
        )

    def fake_chat_json(**_kwargs):  # type: ignore[no-untyped-def]
        return EnrichmentProposalOutput(
            suggested_deviation_text="Suggested enriched deviation text",
            paragraph_refs=["p1"],
        ).model_dump(mode="json")

    monkeypatch.setattr(
        "pdcheck_factory.protocol_enrichment.llm.chat_text_repairs", fake_chat_text_repairs
    )
    monkeypatch.setattr("pdcheck_factory.protocol_enrichment.llm.chat_json", fake_chat_json)
    monkeypatch.setattr(
        pipeline_v2.study_artifact_sync,
        "mirror_upload_path",
        lambda *_a, **_k: None,
    )

    result = service.run_step(study_id, "import-pd-spec-enrich")
    assert "enriched" in result["summary"].lower()
    manifest = service._read_upload_manifest_obj(study_id)
    assert manifest["pdSpecImportMode"] == "enrich"
    assert manifest["reviewDisplaySource"] == "enriched_pd_spec"
    review_path = paths.local_deviations_review_enriched_pd_spec_json(study_id, tmp_path)
    review_obj = read_json(review_path)
    assert review_obj["pd_spec_import_mode"] == "enrich"
    assert review_obj["deviations"][0].get("suggested_deviation_text") == "Suggested enriched deviation text"
    assert review_obj["deviations"][0].get("original_deviation_text")
    assert "text" in review_obj["deviations"][0]
    assert isinstance(review_obj["deviations"][0].get("pd_spec_import"), dict)


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


def test_preprocess_protocol_skips_when_already_indexed(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    service = UiStepService(output_dir=tmp_path)
    study_id = "PREPROTO-SKIP"
    index_path = paths.local_protocol_paragraph_index_json(study_id, tmp_path)
    index_path.parent.mkdir(parents=True, exist_ok=True)
    index_path.write_text('{"paragraphs": []}', encoding="utf-8")

    monkeypatch.setattr(service, "_assert_protocol_upload_ready", lambda _sid: None)
    called = {"extract": False}
    monkeypatch.setattr(
        service,
        "_run_partial_extract",
        lambda *_a, **_k: called.__setitem__("extract", True),
    )

    result = service.preprocess_protocol(study_id)
    assert result.get("skipped") is True
    assert called["extract"] is False
    assert "already" in result["message"].lower()


def test_preprocess_protocol_force_reindexes(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    service = UiStepService(output_dir=tmp_path)
    study_id = "PREPROTO-FORCE"
    proto_md = paths.local_extraction_layout(study_id, "protocol", tmp_path) / "rendered" / "source.md"
    proto_md.parent.mkdir(parents=True, exist_ok=True)
    proto_md.write_text("# Protocol\n\nParagraph one.", encoding="utf-8")
    index_path = paths.local_protocol_paragraph_index_json(study_id, tmp_path)
    index_path.parent.mkdir(parents=True, exist_ok=True)
    index_path.write_text('{"paragraphs": []}', encoding="utf-8")

    monkeypatch.setattr(service, "_assert_protocol_upload_ready", lambda _sid: None)
    monkeypatch.setattr(
        service,
        "_run_partial_extract",
        lambda *_a, **_k: proto_md.write_text("# Protocol\n\nParagraph one.", encoding="utf-8"),
    )

    result = service.preprocess_protocol(study_id, force=True)
    assert result.get("skipped") is not True
    assert index_path.is_file()
    assert "indexed" in result["message"].lower() or "Protocol" in result["message"]


def test_preprocess_rejects_when_pipeline_busy(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from pdcheck_factory.ui_api.service import UiApiError

    service = UiStepService(output_dir=tmp_path)
    study_id = "PREPROTO-BUSY"
    monkeypatch.setattr(service, "_assert_protocol_upload_ready", lambda _sid: None)
    monkeypatch.setattr(
        service,
        "_read_pipeline_run_state",
        lambda _sid: {
            "status": "running",
            "currentSubStepId": "preprocess-acrf",
            "currentStage": "acrf_split",
        },
    )

    with pytest.raises(UiApiError) as exc_info:
        service.preprocess_protocol(study_id)
    assert exc_info.value.code == "PIPELINE_BUSY"


def test_preprocess_acrf_requires_config_for_pdf(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from pdcheck_factory.ui_api.service import UiApiError

    service = UiStepService(output_dir=tmp_path)
    study_id = "PREACRF-CFG"
    monkeypatch.setattr(service, "_assert_acrf_upload_ready", lambda _sid: None)
    monkeypatch.setattr(service, "_is_xls_acrf_mode", lambda _sid: False)
    monkeypatch.setattr(service, "_active_run_entry", lambda _sid: None)

    with pytest.raises(UiApiError) as exc_info:
        service.preprocess_acrf(study_id)
    assert exc_info.value.code == "CONFIG_REQUIRED"


def test_upload_status_includes_acrf_source_type(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    service = UiStepService(output_dir=tmp_path)
    study_id = "STATUS-ACRF-TYPE"
    monkeypatch.setattr(service, "_blob_has_upload", lambda _sid, role: True)
    monkeypatch.setattr(service, "_blob_has_pd_spec_workbook", lambda _sid: False)
    monkeypatch.setattr(
        service,
        "_read_upload_manifest_obj",
        lambda _sid: {
            "protocolFileName": "protocol.pdf",
            "acrfFileName": "acrf.xlsx",
            "acrfSourceType": "xlsx",
            "protocolSize": 10,
            "acrfSize": 20,
        },
    )

    status = service.get_step1_upload_status(study_id)
    assert status["acrfSourceType"] == "xlsx"
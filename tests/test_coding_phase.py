"""Tests for coding phase acceptance and hybrid PD spec upload."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from pdcheck_factory import blob_io, paths
from pdcheck_factory.json_util import write_json
from pdcheck_factory.ui_api.service import ENTRY_MODE_EXTRACTED, ENTRY_MODE_IMPORTED_PD_SPEC, UiApiError, UiStepService


def _seed_step7_state(output_dir: Path, study_id: str, *, status: str) -> None:
    review_path = paths.local_deviations_review_state(study_id, output_dir)
    write_json(
        review_path,
        {
            "schema_version": "1.0.0",
            "study_id": study_id,
            "deviations": [
                {
                    "deviation_id": "dev-0001",
                    "rule_id": "rule-01",
                    "text": "Sample deviation",
                    "paragraph_refs": ["p1"],
                    "status": status,
                    "dm_comment": "",
                }
            ],
        },
    )
    rules_path = paths.local_rules_parsed_json(study_id, output_dir)
    write_json(rules_path, {"rules": [{"rule_id": "rule-01", "title": "R1", "text": "t", "paragraph_refs": ["p1"]}]})


def test_upload_pd_spec_does_not_force_import_entry_mode(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    service = UiStepService(output_dir=tmp_path)
    study_id = "UPLOAD-MODE"
    manifest_path = paths.local_ui_upload_manifest(study_id, tmp_path)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(
        json.dumps({"entryMode": ENTRY_MODE_EXTRACTED, "study_id": study_id}),
        encoding="utf-8",
    )
    uploaded: list[str] = []

    def fake_upload(*, blob_path: str, **_kwargs: object) -> None:
        uploaded.append(blob_path)

    monkeypatch.setattr(blob_io, "blob_service_from_env", lambda: object())
    monkeypatch.setattr(blob_io, "container_from_env", lambda: "container")
    monkeypatch.setattr(blob_io, "upload_blob_bytes", fake_upload)

    result = service.upload_pd_spec_workbook(study_id, b"fake-xlsx", file_name="spec.xlsx")
    assert result["entryMode"] == ENTRY_MODE_EXTRACTED
    assert result["pdSpecBlob"] == paths.pd_spec_workbook_blob(study_id)
    assert paths.pd_spec_workbook_blob(study_id) in uploaded


def test_accept_coding_phase_requires_all_reviewed(tmp_path: Path) -> None:
    service = UiStepService(output_dir=tmp_path)
    study_id = "CODING-GATE"
    _seed_step7_state(tmp_path, study_id, status="to_review")

    with pytest.raises(UiApiError) as blocked:
        service.accept_coding_phase(study_id)
    assert blocked.value.code == "VALIDATION_ERROR"
    assert "accepted or rejected" in blocked.value.message


def test_accept_coding_phase_succeeds_when_all_terminal(tmp_path: Path) -> None:
    service = UiStepService(output_dir=tmp_path)
    study_id = "CODING-OK"
    _seed_step7_state(tmp_path, study_id, status="accepted")

    result = service.accept_coding_phase(study_id)
    assert result["codingPhaseAccepted"] is True
    status = service.get_status(study_id)
    assert status["codingPhaseAccepted"] is True


def test_import_grounding_allowed_in_extracted_mode(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    service = UiStepService(output_dir=tmp_path)
    study_id = "IMPORT-HYBRID"
    manifest_path = paths.local_ui_upload_manifest(study_id, tmp_path)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(
        json.dumps({"entryMode": ENTRY_MODE_EXTRACTED, "study_id": study_id}),
        encoding="utf-8",
    )
    workbook = paths.local_pd_spec_workbook(study_id, tmp_path)
    workbook.parent.mkdir(parents=True, exist_ok=True)
    workbook.write_bytes(b"xlsx")
    index_path = paths.local_protocol_paragraph_index_json(study_id, tmp_path)
    index_path.parent.mkdir(parents=True, exist_ok=True)
    index_path.write_text('{"paragraphs": [{"paragraph_id": "p1"}]}', encoding="utf-8")
    summary_path = paths.local_acrf_summary_text_merged(study_id, tmp_path)
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.write_text('{"datasets": []}', encoding="utf-8")
    dictionary_path = paths.local_acrf_field_dictionary_json(study_id, tmp_path)
    dictionary_path.write_text('{"datasets": [], "field_index": {}}', encoding="utf-8")

    from pdcheck_factory import pipeline_v2

    def fake_import(study_id: str, output_dir: Path, **_kwargs: object) -> dict:
        snap = tmp_path / study_id / "pipeline" / "review" / "deviations_import_v1.json"
        snap.parent.mkdir(parents=True, exist_ok=True)
        snap.write_text('{"deviations": []}', encoding="utf-8")
        return {"import_version": "v1", "deviations": []}

    monkeypatch.setattr(pipeline_v2, "run_import_pd_spec_grounding", fake_import)

    result = service.run_step(study_id, "import-pd-spec-ground")
    assert "Imported and grounded" in result["summary"]

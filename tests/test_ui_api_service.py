from pathlib import Path
from io import BytesIO

import pytest
from openpyxl import Workbook

from pdcheck_factory import blob_io, extraction_resolve, paths
from pdcheck_factory.json_util import read_json, write_json
from pdcheck_factory.ui_api.service import STEP_ORDER, UiApiError, UiStepService, parse_json_body


def _touch(path: Path, content: str = "x") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def test_parse_json_body_rejects_non_object() -> None:
    with pytest.raises(UiApiError) as exc:
        parse_json_body(b"[]")
    assert exc.value.code == "BAD_JSON"


def test_run_step_forwards_llm_instructions_to_extract_rules(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from pdcheck_factory import pipeline_v2

    captured: dict[str, str] = {}

    def fake_rules(sid: str, output_dir: Path, *, additional_instructions: str = "") -> dict:
        captured["additional_instructions"] = additional_instructions
        out_path = paths.local_rules_parsed_json(sid, output_dir)
        _touch(out_path, '{"rules": []}')
        return {"rules": []}

    monkeypatch.setattr(pipeline_v2, "step3_extract_rules", fake_rules)

    service = UiStepService(output_dir=tmp_path)
    study_id = "MY-STUDY"

    proto = extraction_resolve.resolve_protocol_rendered_source_md(study_id, tmp_path)
    acrf = extraction_resolve.resolve_acrf_rendered_source_md(study_id, tmp_path)
    _touch(proto)
    _touch(acrf)
    pindex = paths.local_protocol_paragraph_index_json(study_id, tmp_path)
    _touch(pindex, '{"paragraphs": []}')

    service.run_step(study_id, "extract-rules", llm_instructions="  Focus oncology  ")
    assert captured["additional_instructions"] == "Focus oncology"


def test_status_progression_and_dependency_guard(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    service = UiStepService(output_dir=tmp_path)
    study_id = "MY-STUDY"

    status = service.get_status(study_id)
    assert status["steps"][0]["status"] == "pending"

    protocol = tmp_path / study_id / "extractions" / "protocol" / "opendataloader" / "rendered" / "source.md"
    acrf = tmp_path / study_id / "extractions" / "acrf" / "layout" / "rendered" / "source.md"
    _touch(protocol)
    _touch(acrf)

    status = service.get_status(study_id)
    assert {row["stepId"]: row["status"] for row in status["steps"]}["extract-inputs"] == "done"

    called = {"index": False, "split": False, "acrf": False, "rules": False, "dev": False, "init": False, "pseudo": False, "final": False}

    def fake_index(sid: str, output_dir: Path):
        called["index"] = True
        out = output_dir / sid / "pipeline" / "protocol_index" / "paragraph_index.json"
        _touch(out, '{"paragraphs": []}')
        return {"paragraphs": []}

    def fake_rules(sid: str, output_dir: Path, *args, **kwargs):
        called["rules"] = True
        out = output_dir / sid / "pipeline" / "rules" / "rules_parsed.json"
        _touch(out, '{"rules": []}')
        return {"rules": []}

    def fake_acrf_summary(sid: str, output_dir: Path):
        called["acrf"] = True
        out = output_dir / sid / "pipeline" / "acrf_summary" / "acrf_summary_text_merged.json"
        _touch(out, '{"datasets": []}')
        return {"datasets": []}

    def fake_split_toc(source_md: Path, destination_dir: Path, write_manifest: bool):
        called["split"] = True
        _touch(destination_dir / "001_demo.md", "# demo")
        manifest = destination_dir / "sections_manifest.json"
        if write_manifest:
            _touch(manifest, '{"sections": []}')
        return 1, manifest

    def fake_dev(sid: str, output_dir: Path, *args, **kwargs):
        called["dev"] = True
        out = output_dir / sid / "pipeline" / "deviations" / "deviations_parsed.json"
        _touch(out, '{"deviations": []}')
        return {"deviations": []}

    def fake_init(sid: str, output_dir: Path):
        called["init"] = True
        review = output_dir / sid / "pipeline" / "review" / "deviations_review_state.json"
        _touch(review, '{"deviations": []}')

    def fake_pseudo(sid: str, output_dir: Path):
        called["pseudo"] = True
        out = output_dir / sid / "pipeline" / "pseudo_logic" / "pseudo_logic_validated.json"
        _touch(out, '{"items": []}')
        return {"items": []}

    def fake_final(sid: str, output_dir: Path):
        called["final"] = True
        final_json = output_dir / sid / "pipeline" / "final" / "final_deviations.json"
        final_xlsx = output_dir / sid / "pipeline" / "final" / "final_deviations.xlsx"
        _touch(final_json, '{"items": []}')
        _touch(final_xlsx, "xlsx")
        return {"items": []}

    from pdcheck_factory import pipeline_v2
    from pdcheck_factory import cli as cli_mod

    monkeypatch.setattr(pipeline_v2, "step2_protocol_paragraph_index", fake_index)
    monkeypatch.setattr(pipeline_v2, "step1_acrf_summary_text", fake_acrf_summary)
    monkeypatch.setattr(pipeline_v2, "step3_extract_rules", fake_rules)
    monkeypatch.setattr(pipeline_v2, "step4_5_extract_deviations", fake_dev)
    monkeypatch.setattr(pipeline_v2, "initialize_review_states", fake_init)
    monkeypatch.setattr(pipeline_v2, "step8_generate_pseudo_logic", fake_pseudo)
    monkeypatch.setattr(pipeline_v2, "step10_finalize", fake_final)
    monkeypatch.setattr(cli_mod, "run_acrf_split_toc", fake_split_toc)

    with pytest.raises(UiApiError) as blocked:
        service.run_step(study_id, "extract-rules")
    assert blocked.value.code == "STEP_BLOCKED"

    for step_id in STEP_ORDER[1:]:
        service.run_step(study_id, step_id)

    assert all(called.values())
    final_status = {row["stepId"]: row["status"] for row in service.get_status(study_id)["steps"]}
    assert final_status["review-and-finalize"] == "done"


def test_list_studies_discovers_raw_blob_pairs(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    service = UiStepService(output_dir=tmp_path)

    monkeypatch.setattr(blob_io, "blob_service_from_env", lambda: object())
    monkeypatch.setattr(blob_io, "container_from_env", lambda: "container")
    monkeypatch.setattr(
        blob_io,
        "list_blob_names_with_prefix",
        lambda **_kwargs: [
            "raw/STUDY-A/protocol.pdf",
            "raw/STUDY-A/acrf.pdf",
            "raw/STUDY-B/protocol.pdf",
            "raw/STUDY-C/acrf.pdf",
        ],
    )

    payload = service.list_studies()

    assert [study["studyId"] for study in payload["studies"]] == ["STUDY-A"]
    assert payload["studies"][0]["protocolBlob"] == "raw/STUDY-A/protocol.pdf"
    assert payload["studies"][0]["stepStatuses"]["extract-inputs"] == "pending"


def test_step7_deviations_chat_and_refine(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    service = UiStepService(output_dir=tmp_path)
    study_id = "MY-STUDY"
    rule_path = tmp_path / study_id / "pipeline" / "rules" / "rules_parsed.json"
    review_path = tmp_path / study_id / "pipeline" / "review" / "deviations_review_state.json"
    pseudo_path = tmp_path / study_id / "pipeline" / "review" / "pseudo_logic_review_state.json"
    _touch(
        rule_path,
        '{"rules":[{"rule_id":"rule-001","title":"Visit window timing"}]}',
    )
    _touch(
        tmp_path / study_id / "pipeline" / "protocol_index" / "paragraph_index.json",
        '{"paragraphs":[{"paragraph_id":"p1","text":"Visit must be inside the allowed window."}]}',
    )
    _touch(
        review_path,
        (
            '{"schema_version":"1.0.0","study_id":"MY-STUDY","deviations":['
            '{"deviation_id":"dev-0001","rule_id":"rule-001","text":"Original","paragraph_refs":["p1"],'
            '"data_support_note":"Supported by SV date","status":"to_review","dm_comment":""}]}'
        ),
    )
    _touch(
        pseudo_path,
        (
            '{"schema_version":"1.0.0","study_id":"MY-STUDY","items":['
            '{"deviation_id":"dev-0001","rule_id":"rule-001","pseudo_logic":"SELECT 1",'
            '"programmable":true,"programmability_note":"ok"}]}'
        ),
    )

    from pdcheck_factory import pipeline_v2

    def fake_refine(*, study_id: str, output_dir: Path, row: dict, dm_comment: str, run_revision_cycle: bool):
        updated = dict(row)
        updated["text"] = f"{row.get('text')} :: refined"
        updated["dm_comment"] = dm_comment
        return updated, {
            "study_id": study_id,
            "review_type": "deviations",
            "deviation_id": row.get("deviation_id"),
            "updated_rows": 1,
            "revised_rows": 1,
            "run_revision_cycle": run_revision_cycle,
        }

    monkeypatch.setattr(pipeline_v2, "refine_single_deviation_with_comment", fake_refine)

    list_payload = service.get_step7_deviations(study_id)
    assert list_payload["columns"] == ["rule_id", "deviation_id", "rule_title", "deviation_text", "paragraph_refs", "pseudo_logic"]
    assert list_payload["rows"][0]["deviation_id"] == "dev-0001"
    assert list_payload["rows"][0]["rule_title"] == "Visit window timing"
    assert list_payload["rows"][0]["data_support_note"] == "Supported by SV date"
    assert list_payload["rows"][0]["supporting_sentences"][0]["text"] == "Visit must be inside the allowed window."

    chat_payload = service.get_step7_deviation_chat(study_id, "dev-0001")
    assert chat_payload["messages"] == []

    refined = service.refine_step7_deviation(
        study_id=study_id,
        deviation_id="dev-0001",
        dm_comment="please refine",
        run_revision_cycle=True,
    )
    assert "refined" in refined["row"]["deviation_text"]
    assert len(refined["messages"]) == 2
    assert refined["messages"][0]["role"] == "dm"
    assert refined["messages"][1]["role"] == "assistant"

    updated = service.update_step7_deviation(
        study_id=study_id,
        deviation_id="dev-0001",
        status="accepted",
        dm_comment="approved",
    )
    assert updated["row"]["status"] == "accepted"
    assert updated["row"]["dm_comment"] == "approved"


def test_step7_manual_deviation_crud_and_xlsx_import(tmp_path: Path) -> None:
    service = UiStepService(output_dir=tmp_path)
    study_id = "MY-STUDY"
    _seed_step7_state(tmp_path, study_id, status="pending")

    added = service.create_step7_deviation(
        study_id,
        {
            "deviation_id": "dev-manual",
            "rule_id": "rule-001",
            "text": "Manual deviation",
            "paragraph_refs": ["p1"],
            "data_support_note": "Manual support",
        },
    )
    assert any(row["deviation_id"] == "dev-manual" for row in added["rows"])

    updated = service.patch_step7_deviation_fields(
        study_id,
        "dev-manual",
        {"text": "Manual deviation edited", "status": "accepted"},
    )
    assert updated["row"]["deviation_text"] == "Manual deviation edited"
    assert updated["row"]["status"] == "accepted"

    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["deviation_id", "rule_id", "deviation_text", "paragraph_refs", "data_support_note"])
    sheet.append(["dev-imported", "rule-001", "Imported deviation", "p1", "Imported support"])
    buffer = BytesIO()
    workbook.save(buffer)

    imported = service.import_step7_deviations_xlsx(study_id, buffer.getvalue())
    assert imported["imported"] == 1
    assert any(row["deviation_id"] == "dev-imported" for row in imported["rows"])

    with pytest.raises(UiApiError) as duplicate:
        service.import_step7_deviations_xlsx(study_id, buffer.getvalue())
    assert duplicate.value.code == "VALIDATION_ERROR"

    deleted = service.delete_step7_deviation(study_id, "dev-manual")
    assert all(row["deviation_id"] != "dev-manual" for row in deleted["rows"])

    state = read_json(paths.local_deviations_review_state(study_id, tmp_path))
    assert any(row.get("entry_source") == "imported" for row in state["deviations"])


def test_step7_manual_rule_crud(tmp_path: Path) -> None:
    service = UiStepService(output_dir=tmp_path)
    study_id = "MY-STUDY"
    _seed_step7_state(tmp_path, study_id, status="pending")

    created = service.create_step7_rule(
        study_id,
        {"rule_id": "rule-manual", "title": "Manual rule", "text": "Rule body"},
    )
    assert created["rule"]["rule_id"] == "rule-manual"

    updated = service.update_step7_rule(study_id, "rule-manual", {"title": "Manual rule edited"})
    assert updated["rule"]["title"] == "Manual rule edited"

    deleted = service.delete_step7_rule(study_id, "rule-manual")
    assert deleted["deletedRuleId"] == "rule-manual"


def _seed_step7_state(tmp_path: Path, study_id: str, status: str = "accepted") -> None:
    rule_path = tmp_path / study_id / "pipeline" / "rules" / "rules_parsed.json"
    review_path = tmp_path / study_id / "pipeline" / "review" / "deviations_review_state.json"
    validated_path = tmp_path / study_id / "pipeline" / "deviations" / "deviations_validated.json"
    _touch(
        rule_path,
        '{"rules":[{"rule_id":"rule-001","title":"Visit window timing"}]}',
    )
    state_json = (
        '{"schema_version":"1.0.0","study_id":"' + study_id + '","deviations":['
        '{"deviation_id":"dev-0001","rule_id":"rule-001","text":"Original","paragraph_refs":["p1"],'
        '"status":"' + status + '","dm_comment":""}]}'
    )
    _touch(review_path, state_json)
    _touch(validated_path, state_json)


def test_generate_step7_pseudo_logic_for_deviation_writes_state(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    service = UiStepService(output_dir=tmp_path)
    study_id = "MY-STUDY"
    _seed_step7_state(tmp_path, study_id, status="accepted")

    from pdcheck_factory import paths, pipeline_v2

    def fake_single(*, study_id: str, output_dir: Path, deviation: dict, rule_by_id=None):
        return {
            "deviation_id": deviation["deviation_id"],
            "rule_id": deviation["rule_id"],
            "rule_title": "Visit window timing",
            "pseudo_logic": "SELECT * FROM dm",
            "programmable": True,
            "programmability_note": "ok",
            "status": "pending",
            "dm_comment": "",
        }

    monkeypatch.setattr(pipeline_v2, "generate_pseudo_logic_for_deviation", fake_single)

    payload = service.generate_step7_pseudo_logic_for_deviation(study_id, "dev-0001")
    assert payload["row"]["pseudo_logic"] == "SELECT * FROM dm"
    assert payload["row"]["programmable"] is True
    assert payload["row"]["programmability_note"] == "ok"

    review_state_path = paths.local_pseudo_logic_review_state(study_id, tmp_path)
    validated_path = paths.local_pseudo_logic_validated_json(study_id, tmp_path)
    assert review_state_path.is_file()
    assert validated_path.is_file()
    review_obj = read_json(review_state_path)
    assert any(item.get("deviation_id") == "dev-0001" for item in review_obj.get("items", []))


def test_generate_step7_pseudo_logic_for_deviation_rejects_non_accepted(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    service = UiStepService(output_dir=tmp_path)
    study_id = "MY-STUDY"
    _seed_step7_state(tmp_path, study_id, status="pending")

    from pdcheck_factory import pipeline_v2

    def fake_single(**_kwargs):
        raise AssertionError("should not be called")

    monkeypatch.setattr(pipeline_v2, "generate_pseudo_logic_for_deviation", fake_single)

    with pytest.raises(UiApiError) as blocked:
        service.generate_step7_pseudo_logic_for_deviation(study_id, "dev-0001")
    assert blocked.value.code == "STEP_BLOCKED"
    assert blocked.value.status_code == 409


def test_generate_step7_pseudo_logic_bulk_returns_rows_and_count(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    service = UiStepService(output_dir=tmp_path)
    study_id = "MY-STUDY"
    _seed_step7_state(tmp_path, study_id, status="accepted")

    from pdcheck_factory import paths, pipeline_v2

    def fake_bulk(sid: str, output_dir: Path):
        out = {
            "schema_version": "1.0.0",
            "study_id": sid,
            "generated_at": "2024-01-01T00:00:00Z",
            "items": [
                {
                    "deviation_id": "dev-0001",
                    "rule_id": "rule-001",
                    "rule_title": "Visit window timing",
                    "pseudo_logic": "SELECT 1",
                    "programmable": True,
                    "programmability_note": "ok",
                    "status": "pending",
                    "dm_comment": "",
                }
            ],
        }
        review_state_path = paths.local_pseudo_logic_review_state(sid, output_dir)
        validated_path = paths.local_pseudo_logic_validated_json(sid, output_dir)
        write_json(review_state_path, out)
        write_json(validated_path, out)
        return out

    monkeypatch.setattr(pipeline_v2, "step8_generate_pseudo_logic", fake_bulk)

    payload = service.generate_step7_pseudo_logic_bulk(study_id)
    assert payload["generated"] == 1
    assert payload["rows"][0]["deviation_id"] == "dev-0001"
    assert payload["rows"][0]["pseudo_logic"] == "SELECT 1"
    assert payload["rows"][0]["rule_title"] == "Visit window timing"


def test_run_step1_extract_opendataloader_flags_and_choice(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    service = UiStepService(output_dir=tmp_path)
    study_id = "EX-S"
    captured: dict = {}

    def fake_run_extract(**kwargs: object) -> None:
        captured.update(kwargs)

    from pdcheck_factory import cli as cli_mod

    monkeypatch.setattr(cli_mod, "run_extract", fake_run_extract)
    out = service.run_step1_extract(study_id, extractor="opendataloader")
    assert captured.get("opendataloader_only") is True
    assert captured.get("run_opendataloader_ocr") is True
    assert out["extractor"] == "opendataloader"
    choice_path = extraction_resolve.local_ui_extractor_choice_json(study_id, tmp_path)
    assert choice_path.is_file()
    assert read_json(choice_path)["extractor"] == "opendataloader"


def test_run_step1_extract_document_intelligence_flags(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    service = UiStepService(output_dir=tmp_path)
    study_id = "EX-S"
    captured: dict = {}

    def fake_run_extract(**kwargs: object) -> None:
        captured.update(kwargs)

    from pdcheck_factory import cli as cli_mod

    monkeypatch.setattr(cli_mod, "run_extract", fake_run_extract)
    out = service.run_step1_extract(study_id, extractor="document_intelligence")
    assert captured.get("opendataloader_only") is False
    assert captured.get("run_opendataloader_ocr") is False
    assert out["extractor"] == "document_intelligence"
    choice_path = extraction_resolve.local_ui_extractor_choice_json(study_id, tmp_path)
    assert read_json(choice_path)["extractor"] == "document_intelligence"


def test_run_step1_extract_default_both(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    service = UiStepService(output_dir=tmp_path)
    study_id = "EX-S"
    captured: dict = {}

    def fake_run_extract(**kwargs: object) -> None:
        captured.update(kwargs)

    from pdcheck_factory import cli as cli_mod

    monkeypatch.setattr(cli_mod, "run_extract", fake_run_extract)
    out = service.run_step1_extract(study_id, extractor=None)
    assert captured.get("run_opendataloader_ocr") is True
    assert captured.get("opendataloader_only") is False
    assert out["extractor"] == "both"
    assert read_json(extraction_resolve.local_ui_extractor_choice_json(study_id, tmp_path))["extractor"] == "both"


def test_upload_step1_files_persists_original_filenames(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    service = UiStepService(output_dir=tmp_path)
    study_id = "UP-S"

    monkeypatch.setattr(blob_io, "blob_service_from_env", lambda: object())
    monkeypatch.setattr(blob_io, "container_from_env", lambda: "container")
    monkeypatch.setattr(blob_io, "upload_blob_bytes", lambda **_kwargs: None)

    out = service.upload_step1_files(
        study_id,
        b"protocol-bytes",
        b"acrf-bytes",
        protocol_file_name="Protocol_v3_final.pdf",
        acrf_file_name="aCRF_annotated.pdf",
    )

    assert out["protocolFileName"] == "Protocol_v3_final.pdf"
    assert out["acrfFileName"] == "aCRF_annotated.pdf"
    manifest = read_json(paths.local_ui_upload_manifest(study_id, tmp_path))
    assert manifest["protocolFileName"] == "Protocol_v3_final.pdf"
    assert manifest["acrfFileName"] == "aCRF_annotated.pdf"

    preview = service.get_step1_preview(study_id)
    assert preview["protocolFileName"] == "Protocol_v3_final.pdf"
    assert preview["acrfFileName"] == "aCRF_annotated.pdf"


def test_get_step1_preview_filename_fallback_without_manifest(tmp_path: Path) -> None:
    service = UiStepService(output_dir=tmp_path)
    study_id = "FB-S"
    preview = service.get_step1_preview(study_id)
    assert preview["protocolFileName"] == "protocol.pdf"
    assert preview["acrfFileName"] == "acrf.pdf"


def test_run_step1_extract_invalid_extractor(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    service = UiStepService(output_dir=tmp_path)

    def fake_run_extract(**_kwargs: object) -> None:
        raise AssertionError("run_extract should not be called")

    from pdcheck_factory import cli as cli_mod

    monkeypatch.setattr(cli_mod, "run_extract", fake_run_extract)
    with pytest.raises(UiApiError) as exc:
        service.run_step1_extract("EX-S", extractor="bogus")
    assert exc.value.code == "VALIDATION_ERROR"

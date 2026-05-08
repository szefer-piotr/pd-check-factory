from pathlib import Path

import pytest

from pdcheck_factory.ui_api.service import STEP_ORDER, UiApiError, UiStepService, parse_json_body


def _touch(path: Path, content: str = "x") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def test_parse_json_body_rejects_non_object() -> None:
    with pytest.raises(UiApiError) as exc:
        parse_json_body(b"[]")
    assert exc.value.code == "BAD_JSON"


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

    def fake_rules(sid: str, output_dir: Path):
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

    def fake_dev(sid: str, output_dir: Path):
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
        review_path,
        (
            '{"schema_version":"1.0.0","study_id":"MY-STUDY","deviations":['
            '{"deviation_id":"dev-0001","rule_id":"rule-001","text":"Original","paragraph_refs":["p1"],'
            '"status":"to_review","dm_comment":""}]}'
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

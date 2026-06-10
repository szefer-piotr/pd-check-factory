import json
from pathlib import Path

import pytest

from pdcheck_factory import extraction_resolve, paths
from pdcheck_factory.json_util import read_json, write_json
from pdcheck_factory.ui_api.service import UiStepService


def _touch(path: Path, content: str = "x") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _dataset_reply(dataset_name: str) -> str:
    return (
        f"<<<BEGIN_DATASET>>>\n"
        f"DATASET_NAME: {dataset_name}\n"
        f"COLUMN_NAME: col1\n"
        f"COLUMN_DESCRIPTION: desc\n"
        f"COLUMN_VALUES: val\n"
        f"<<<END_DATASET>>>"
    )


def _seed_acrf_sections(study_id: str, output_dir: Path, section_ids: list[str]) -> None:
    acrf = extraction_resolve.resolve_acrf_rendered_source_md(study_id, output_dir)
    _touch(acrf)
    sections_dir = extraction_resolve.resolve_acrf_sections_toc_dir(study_id, output_dir)
    for section_id in section_ids:
        _touch(sections_dir / f"{section_id}.md", f"# {section_id}\n")


def _seed_deviation_deps(study_id: str, output_dir: Path, *, rule_count: int = 10) -> None:
    pindex = paths.local_protocol_paragraph_index_json(study_id, output_dir)
    rules = paths.local_rules_parsed_json(study_id, output_dir)
    acrf_summary = paths.local_acrf_summary_text_merged(study_id, output_dir)
    _touch(pindex, json.dumps({"paragraphs": [{"paragraph_id": "p1", "text": "Protocol paragraph"}]}))
    _touch(
        rules,
        json.dumps(
            {
                "rules": [
                    {
                        "rule_id": f"rule-{i:03d}",
                        "title": f"Rule {i}",
                        "text": f"Rule text {i}",
                        "paragraph_refs": ["p1"],
                    }
                    for i in range(1, rule_count + 1)
                ]
            }
        ),
    )
    _touch(acrf_summary, json.dumps({"datasets": []}))


def test_get_extraction_live_returns_full_text(tmp_path: Path) -> None:
    service = UiStepService(output_dir=tmp_path)
    study_id = "MY-STUDY"
    long_text = "x" * 5000
    rules_path = paths.local_rules_parsed_json(study_id, tmp_path)
    dev_path = paths.local_deviations_parsed_json(study_id, tmp_path)
    _touch(
        rules_path,
        json.dumps(
            {
                "rules": [
                    {
                        "rule_id": "rule-001",
                        "title": "Title",
                        "text": long_text,
                        "paragraph_refs": ["p1"],
                    }
                ]
            }
        ),
    )
    _touch(
        dev_path,
        json.dumps(
            {
                "schema_version": "1.0.0",
                "study_id": study_id,
                "generated_at": "2026-01-01T00:00:00+00:00",
                "deviations": [
                    {
                        "deviation_id": "dev-0001",
                        "rule_id": "rule-001",
                        "text": long_text,
                        "paragraph_refs": ["p1"],
                        "status": "pending",
                    }
                ],
                "completed_rule_ids": ["rule-001"],
                "partial": True,
            }
        ),
    )

    live = service.get_extraction_live(study_id)
    assert live["ruleCount"] == 1
    assert live["deviationCount"] == 1
    assert live["partial"] is True
    assert live["completedRuleIds"] == ["rule-001"]
    assert len(live["rules"][0]["text"]) == 5000
    assert len(live["deviations"][0]["text"]) == 5000


def test_read_pipeline_run_state_tolerates_empty_file(tmp_path: Path) -> None:
    service = UiStepService(output_dir=tmp_path)
    study_id = "MY-STUDY"
    state_path = paths.local_ui_pipeline_run_state(study_id, tmp_path)
    _touch(state_path, "")

    state = service._read_pipeline_run_state(study_id)
    assert state["status"] == "idle"
    assert state["logs"] == []

    service.get_step1_run_state(study_id)
    assert state_path.read_text(encoding="utf-8").strip() == "" or service._read_pipeline_run_state(study_id)["status"] == "idle"


def test_step_artifact_complete_rejects_partial_acrf_summary(tmp_path: Path) -> None:
    service = UiStepService(output_dir=tmp_path)
    study_id = "MY-STUDY"
    summary_path = paths.local_acrf_summary_text_merged(study_id, tmp_path)
    _touch(
        summary_path,
        json.dumps(
            {
                "schema_version": "1.0.0",
                "study_id": study_id,
                "generated_at": "2026-01-01T00:00:00+00:00",
                "datasets": [{"dataset_name": "DM", "columns": []}],
                "completed_section_ids": ["sec_01"],
                "partial": True,
            }
        ),
    )

    assert service._step_artifact_complete(study_id, "acrf-summary-text") is False
    statuses = service._step_statuses(study_id)
    assert statuses["acrf-summary-text"] == "pending"


def test_step_artifact_complete_rejects_partial_with_stale_review(tmp_path: Path) -> None:
    service = UiStepService(output_dir=tmp_path)
    study_id = "MY-STUDY"
    parsed = paths.local_deviations_parsed_json(study_id, tmp_path)
    review = paths.local_deviations_review_state(study_id, tmp_path)
    _touch(
        parsed,
        json.dumps(
            {
                "schema_version": "1.0.0",
                "study_id": study_id,
                "generated_at": "2026-01-01T00:00:00+00:00",
                "deviations": [],
                "partial": True,
            }
        ),
    )
    _touch(review, json.dumps({"deviations": []}))

    assert service._step_artifact_complete(study_id, "extract-deviations") is False
    statuses = service._step_statuses(study_id)
    assert statuses["extract-deviations"] == "pending"


def test_acrf_summary_resumes_from_checkpoint(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from pdcheck_factory import pipeline_v2

    study_id = "MY-STUDY"
    section_ids = [f"sec_{i:02d}" for i in range(1, 11)]
    _seed_acrf_sections(study_id, tmp_path, section_ids)

    called_section_ids: list[str] = []
    call_count = {"n": 0}
    first_run = {"active": True}

    def fake_chat_text_repairs(*, system, user, validate_reply, max_repairs, label):
        del system, user, validate_reply, max_repairs
        section_id = label.replace("v2-acrf-", "")
        called_section_ids.append(section_id)
        call_count["n"] += 1
        if first_run["active"] and call_count["n"] == 4:
            raise RuntimeError("simulated interruption after section 3")
        return _dataset_reply(section_id)

    monkeypatch.setattr(pipeline_v2.llm, "chat_text_repairs", fake_chat_text_repairs)

    with pytest.raises(RuntimeError, match="simulated interruption"):
        pipeline_v2.step1_acrf_summary_text(study_id, tmp_path)

    checkpoint = read_json(paths.local_acrf_summary_text_merged(study_id, tmp_path))
    assert checkpoint.get("partial") is True
    assert checkpoint.get("completed_section_ids") == ["sec_01", "sec_02", "sec_03"]
    assert len(checkpoint.get("datasets", [])) == 3

    called_section_ids.clear()
    call_count["n"] = 0
    first_run["active"] = False
    pipeline_v2.step1_acrf_summary_text(study_id, tmp_path)

    assert called_section_ids == [f"sec_{i:02d}" for i in range(4, 11)]
    final = read_json(paths.local_acrf_summary_text_merged(study_id, tmp_path))
    assert "partial" not in final
    assert len(final.get("datasets", [])) == 10


def test_acrf_summary_force_clears_checkpoint(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from pdcheck_factory import pipeline_v2

    study_id = "MY-STUDY"
    section_ids = ["sec_01", "sec_02", "sec_03"]
    _seed_acrf_sections(study_id, tmp_path, section_ids)
    summary_path = paths.local_acrf_summary_text_merged(study_id, tmp_path)
    write_json(
        summary_path,
        {
            "schema_version": "1.0.0",
            "study_id": study_id,
            "generated_at": "2026-01-01T00:00:00+00:00",
            "datasets": [{"dataset_name": "OLD", "columns": []}],
            "completed_section_ids": ["sec_01", "sec_02"],
            "partial": True,
        },
    )

    called_section_ids: list[str] = []

    def fake_chat_text_repairs(*, system, user, validate_reply, max_repairs, label):
        del system, user, validate_reply, max_repairs
        section_id = label.replace("v2-acrf-", "")
        called_section_ids.append(section_id)
        return _dataset_reply(section_id)

    monkeypatch.setattr(pipeline_v2.llm, "chat_text_repairs", fake_chat_text_repairs)

    pipeline_v2.step1_acrf_summary_text(study_id, tmp_path, force=True)

    assert called_section_ids == section_ids
    final = read_json(summary_path)
    assert "partial" not in final
    assert final["datasets"][0]["dataset_name"] == "sec_01"


def test_extract_deviations_resumes_from_checkpoint(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from pdcheck_factory import pipeline_v2

    study_id = "MY-STUDY"
    _seed_deviation_deps(study_id, tmp_path, rule_count=10)

    called_rule_ids: list[str] = []
    call_count = {"n": 0}
    first_run = {"active": True}

    def fake_chat_text_repairs(*, system, user, validate_reply, max_repairs, label):
        del system, validate_reply, max_repairs
        rule_id = label.replace("v2-dev-", "")
        called_rule_ids.append(rule_id)
        call_count["n"] += 1
        if first_run["active"] and call_count["n"] == 4:
            raise RuntimeError("simulated interruption after rule 3")
        return (
            f"<<<BEGIN_DEVIATION>>>\n"
            f"DEVIATION_TEXT: Candidate text for {rule_id}\n"
            f"PARAGRAPH_REFS: p1\n"
            f"<<<END_DEVIATION>>>"
        )

    monkeypatch.setattr(pipeline_v2.llm, "chat_text_repairs", fake_chat_text_repairs)

    with pytest.raises(RuntimeError, match="simulated interruption"):
        pipeline_v2.step4_5_extract_deviations(study_id, tmp_path)

    checkpoint = read_json(paths.local_deviations_parsed_json(study_id, tmp_path))
    assert checkpoint.get("partial") is True
    assert checkpoint.get("completed_rule_ids") == ["rule-001", "rule-002", "rule-003"]
    first_dev_ids = [d["deviation_id"] for d in checkpoint.get("deviations", [])]
    assert first_dev_ids
    assert first_dev_ids[0] == "dev-0001"

    called_rule_ids.clear()
    call_count["n"] = 0
    first_run["active"] = False
    pipeline_v2.step4_5_extract_deviations(study_id, tmp_path)

    assert called_rule_ids == [f"rule-{i:03d}" for i in range(4, 11)]
    final = read_json(paths.local_deviations_parsed_json(study_id, tmp_path))
    assert "partial" not in final
    resumed_dev_ids = [d["deviation_id"] for d in final.get("deviations", [])]
    assert resumed_dev_ids[: len(first_dev_ids)] == first_dev_ids


def test_extract_deviations_force_clears_checkpoint(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from pdcheck_factory import pipeline_v2

    study_id = "MY-STUDY"
    _seed_deviation_deps(study_id, tmp_path, rule_count=3)
    parsed_path = paths.local_deviations_parsed_json(study_id, tmp_path)
    write_json(
        parsed_path,
        {
            "schema_version": "1.0.0",
            "study_id": study_id,
            "generated_at": "2026-01-01T00:00:00+00:00",
            "deviations": [
                {
                    "deviation_id": "dev-0099",
                    "rule_id": "rule-001",
                    "text": "old",
                    "paragraph_refs": ["p1"],
                    "status": "pending",
                }
            ],
            "completed_rule_ids": ["rule-001", "rule-002"],
            "partial": True,
        },
    )

    called_rule_ids: list[str] = []

    def fake_chat_text_repairs(*, system, user, validate_reply, max_repairs, label):
        del system, user, validate_reply, max_repairs
        rule_id = label.replace("v2-dev-", "")
        called_rule_ids.append(rule_id)
        return (
            f"<<<BEGIN_DEVIATION>>>\n"
            f"DEVIATION_TEXT: Fresh text for {rule_id}\n"
            f"PARAGRAPH_REFS: p1\n"
            f"<<<END_DEVIATION>>>"
        )

    monkeypatch.setattr(pipeline_v2.llm, "chat_text_repairs", fake_chat_text_repairs)

    pipeline_v2.step4_5_extract_deviations(study_id, tmp_path, force=True)

    assert called_rule_ids == ["rule-001", "rule-002", "rule-003"]
    final = read_json(parsed_path)
    assert "partial" not in final
    assert final["deviations"][0]["deviation_id"] == "dev-0001"
    assert final["deviations"][0]["text"] == "Fresh text for rule-001"


def test_run_step_force_clears_review_state_before_extract(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from pdcheck_factory import pipeline_v2

    service = UiStepService(output_dir=tmp_path)
    study_id = "MY-STUDY"
    _seed_deviation_deps(study_id, tmp_path, rule_count=2)
    review = paths.local_deviations_review_state(study_id, tmp_path)
    _touch(review, json.dumps({"deviations": [{"deviation_id": "dev-stale"}]}))

    def fake_deviations(sid, output_dir, *, additional_instructions="", progress_callback=None, force=False):
        assert force is True
        out = paths.local_deviations_parsed_json(sid, output_dir)
        _touch(out, json.dumps({"deviations": [{"deviation_id": "dev-0001"}]}))
        return {"deviations": [{"deviation_id": "dev-0001"}]}

    monkeypatch.setattr(pipeline_v2, "step4_5_extract_deviations", fake_deviations)
    monkeypatch.setattr(pipeline_v2, "initialize_review_states", lambda *args, **kwargs: None)

    service.run_step(study_id, "extract-deviations", force=True)
    assert not review.exists() or service._step_artifact_complete(study_id, "extract-deviations") is False


def test_sync_partial_review_state_exposes_rows_in_step7(tmp_path: Path) -> None:
    from pdcheck_factory import pipeline_v2, review_sources

    service = UiStepService(output_dir=tmp_path)
    study_id = "MY-STUDY"
    _seed_deviation_deps(study_id, tmp_path, rule_count=2)

    parsed_path = paths.local_deviations_parsed_json(study_id, tmp_path)
    write_json(
        parsed_path,
        {
            "schema_version": "1.0.0",
            "study_id": study_id,
            "generated_at": "2026-01-01T00:00:00+00:00",
            "deviations": [
                {
                    "deviation_id": "dev-0001",
                    "rule_id": "rule-001",
                    "text": "Partial deviation",
                    "paragraph_refs": ["p1"],
                    "status": "pending",
                }
            ],
            "completed_rule_ids": ["rule-001"],
            "partial": True,
        },
    )

    pipeline_v2.sync_partial_review_state(study_id, tmp_path)

    generated_path = review_sources.review_state_path(
        study_id, tmp_path, review_sources.REVIEW_SOURCE_GENERATED
    )
    assert generated_path.is_file()
    generated = read_json(generated_path)
    assert len(generated["deviations"]) == 1
    assert generated["deviations"][0]["deviation_id"] == "dev-0001"

    payload = service.get_step7_deviations(study_id)
    assert len(payload["rows"]) == 1
    assert payload["rows"][0]["deviation_id"] == "dev-0001"

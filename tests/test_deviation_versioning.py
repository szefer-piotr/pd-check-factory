"""Tests for deviation source lineage, overwrite/new version modes, and per-rule dedup."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from pdcheck_factory import paths, step_artifact_versions
from pdcheck_factory.json_util import read_json, write_json
from pdcheck_factory.ui_api.service import UiApiError, UiStepService


def _touch(path: Path, content: str = "x") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _seed_deviation_deps(study_id: str, output_dir: Path, *, rule_count: int = 2) -> None:
    pindex = paths.local_protocol_paragraph_index_json(study_id, output_dir)
    rules = paths.local_rules_parsed_json(study_id, output_dir)
    acrf_summary = paths.local_acrf_summary_text_merged(study_id, output_dir)
    acrf_dictionary = paths.local_acrf_field_dictionary_json(study_id, output_dir)
    _touch(
        pindex,
        json.dumps(
            {
                "schema_version": "1.0.0",
                "generated_at": "2026-01-01T00:00:00+00:00",
                "paragraphs": [{"paragraph_id": "p1", "text": "Protocol paragraph"}],
            }
        ),
    )
    _touch(
        rules,
        json.dumps(
            {
                "schema_version": "1.0.0",
                "study_id": study_id,
                "generated_at": "2026-01-01T00:00:00+00:00",
                "rules": [
                    {
                        "rule_id": f"rule-{i:03d}",
                        "title": f"Rule {i}",
                        "text": f"Rule text {i}",
                        "paragraph_refs": ["p1"],
                    }
                    for i in range(1, rule_count + 1)
                ],
            }
        ),
    )
    _touch(
        acrf_summary,
        json.dumps(
            {
                "schema_version": "1.0.0",
                "generated_at": "2026-01-01T00:00:00+00:00",
                "datasets": [],
            }
        ),
    )
    _touch(
        acrf_dictionary,
        json.dumps(
            {
                "schema_version": "1.0.0",
                "generated_at": "2026-01-01T00:00:00+00:00",
                "datasets": [],
                "field_index": {},
            }
        ),
    )


def _seed_manifest_active(service: UiStepService, study_id: str, **active: str) -> None:
    service._write_upload_manifest(study_id, active_step_artifacts=dict(active))


def test_resolve_deviation_source_versions_fingerprints(tmp_path: Path) -> None:
    study_id = "SRC-FP"
    _seed_deviation_deps(study_id, tmp_path)
    sources = step_artifact_versions.resolve_deviation_source_versions(
        study_id,
        tmp_path,
        {"acrf-summary-text": "v1", "extract-rules": "v2"},
    )
    assert sources["acrf-summary-text"] == "v1"
    assert sources["extract-rules"] == "v2"
    assert sources["protocol-index"]["exists"] is True
    assert sources["protocol-index"]["sha256"]
    assert sources["protocol-index"]["paragraph_count"] == 1
    assert sources["acrf-field-dictionary"]["exists"] is True
    assert sources["acrf-field-dictionary"]["sha256"]


def test_extract_deviations_version_lineage_and_new_mode(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from pdcheck_factory import pipeline_v2

    service = UiStepService(output_dir=tmp_path)
    study_id = "DEV-LINEAGE"
    _seed_deviation_deps(study_id, tmp_path)
    _seed_manifest_active(
        service, study_id, **{"acrf-summary-text": "v1", "extract-rules": "v1"}
    )

    run_n = {"n": 0}

    def fake_extract(sid, output_dir, **kwargs):
        run_n["n"] += 1
        obj = {
            "schema_version": "1.0.0",
            "study_id": sid,
            "generated_at": f"2026-01-0{run_n['n']}T00:00:00+00:00",
            "deviations": [
                {
                    "deviation_id": "dev-0001",
                    "rule_id": "rule-001",
                    "text": f"Deviation run {run_n['n']}",
                    "paragraph_refs": ["p1"],
                    "status": "pending",
                    "dm_comment": "",
                }
            ],
        }
        write_json(paths.local_deviations_parsed_json(sid, output_dir), obj)
        return obj

    monkeypatch.setattr(pipeline_v2, "step4_5_extract_deviations", fake_extract)
    monkeypatch.setattr(pipeline_v2, "initialize_review_states", lambda *a, **k: None)

    # Seed review files so version registration can copy them.
    def _init_review(sid, output_dir):
        parsed = read_json(paths.local_deviations_parsed_json(sid, output_dir))
        for path_fn in (
            paths.local_deviations_review_state,
            paths.local_deviations_review_generated_json,
            paths.local_deviations_validated_json,
        ):
            write_json(path_fn(sid, output_dir), parsed)

    monkeypatch.setattr(pipeline_v2, "initialize_review_states", _init_review)

    out1 = service.run_step(study_id, "extract-deviations", force=True, version_mode="new")
    assert out1["version"] == "v1"

    parsed = read_json(paths.local_deviations_parsed_json(study_id, tmp_path))
    assert "source_versions" in parsed
    assert parsed["source_versions"]["extract-rules"] == "v1"

    manifest = step_artifact_versions.get_version_manifest(
        study_id, tmp_path, "extract-deviations", "v1"
    )
    assert manifest["sourceVersions"]["extract-rules"] == "v1"
    assert "derivedFrom" not in manifest
    assert "deviations_review_generated.json" in manifest["files"]

    out2 = service.run_step(study_id, "extract-deviations", force=True, version_mode="new")
    assert out2["version"] == "v2"
    listed = step_artifact_versions.list_step_versions(
        study_id, tmp_path, "extract-deviations", active_version="v2"
    )
    assert len(listed["versions"]) == 2
    assert listed["versions"][0]["sourceSummary"]


def test_extract_deviations_overwrite_same_sources(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from pdcheck_factory import pipeline_v2

    service = UiStepService(output_dir=tmp_path)
    study_id = "DEV-OW"
    _seed_deviation_deps(study_id, tmp_path)
    _seed_manifest_active(
        service, study_id, **{"acrf-summary-text": "v1", "extract-rules": "v1"}
    )

    run_n = {"n": 0}

    def fake_extract(sid, output_dir, **kwargs):
        run_n["n"] += 1
        obj = {
            "schema_version": "1.0.0",
            "study_id": sid,
            "generated_at": f"2026-02-0{run_n['n']}T00:00:00+00:00",
            "deviations": [
                {
                    "deviation_id": "dev-0001",
                    "rule_id": "rule-001",
                    "text": f"Text {run_n['n']}",
                    "paragraph_refs": ["p1"],
                    "status": "pending",
                }
            ],
        }
        write_json(paths.local_deviations_parsed_json(sid, output_dir), obj)
        return obj

    def _init_review(sid, output_dir):
        parsed = read_json(paths.local_deviations_parsed_json(sid, output_dir))
        for path_fn in (
            paths.local_deviations_review_state,
            paths.local_deviations_review_generated_json,
            paths.local_deviations_validated_json,
        ):
            write_json(path_fn(sid, output_dir), parsed)

    monkeypatch.setattr(pipeline_v2, "step4_5_extract_deviations", fake_extract)
    monkeypatch.setattr(pipeline_v2, "initialize_review_states", _init_review)

    # Seed stale pseudo that must be cleared on force extract.
    pseudo = paths.local_pseudo_logic_review_state(study_id, tmp_path)
    write_json(
        pseudo,
        {
            "schema_version": "1.0.0",
            "study_id": study_id,
            "items": [{"deviation_id": "dev-0001", "pseudo_logic": "OLD"}],
        },
    )

    out1 = service.run_step(study_id, "extract-deviations", force=True, version_mode="new")
    assert out1["version"] == "v1"
    assert not pseudo.is_file()

    plan = service.get_extract_deviations_version_plan(study_id)
    assert plan["matchingVersion"] == "v1"

    out2 = service.run_step(
        study_id,
        "extract-deviations",
        force=True,
        version_mode="overwrite",
        overwrite_version="v1",
    )
    assert out2["version"] == "v1"
    listed = step_artifact_versions.list_step_versions(
        study_id, tmp_path, "extract-deviations", active_version="v1"
    )
    assert len(listed["versions"]) == 1
    snap = read_json(
        step_artifact_versions.version_artifact_path(
            study_id, tmp_path, "extract-deviations", "v1", "deviations_parsed.json"
        )
    )
    assert snap["deviations"][0]["text"] == "Text 2"
    assert "derived_from" not in snap or snap.get("derived_from") in (None, {})


def test_extract_deviations_overwrite_source_mismatch_409(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from pdcheck_factory import pipeline_v2

    service = UiStepService(output_dir=tmp_path)
    study_id = "DEV-MISMATCH"
    _seed_deviation_deps(study_id, tmp_path)
    _seed_manifest_active(
        service, study_id, **{"acrf-summary-text": "v1", "extract-rules": "v1"}
    )

    def fake_extract(sid, output_dir, **kwargs):
        obj = {
            "schema_version": "1.0.0",
            "study_id": sid,
            "generated_at": "2026-01-01T00:00:00+00:00",
            "deviations": [
                {
                    "deviation_id": "dev-0001",
                    "rule_id": "rule-001",
                    "text": "Text",
                    "paragraph_refs": ["p1"],
                    "status": "pending",
                }
            ],
        }
        write_json(paths.local_deviations_parsed_json(sid, output_dir), obj)
        return obj

    def _init_review(sid, output_dir):
        parsed = read_json(paths.local_deviations_parsed_json(sid, output_dir))
        for path_fn in (
            paths.local_deviations_review_state,
            paths.local_deviations_review_generated_json,
            paths.local_deviations_validated_json,
        ):
            write_json(path_fn(sid, output_dir), parsed)

    monkeypatch.setattr(pipeline_v2, "step4_5_extract_deviations", fake_extract)
    monkeypatch.setattr(pipeline_v2, "initialize_review_states", _init_review)

    service.run_step(study_id, "extract-deviations", force=True, version_mode="new")

    # Change active rules version so sources no longer match v1.
    _seed_manifest_active(
        service,
        study_id,
        **{"acrf-summary-text": "v1", "extract-rules": "v2", "extract-deviations": "v1"},
    )

    with pytest.raises(UiApiError) as exc:
        service.run_step(
            study_id,
            "extract-deviations",
            force=True,
            version_mode="overwrite",
            overwrite_version="v1",
        )
    assert exc.value.status_code == 409
    assert "sources do not match" in exc.value.message


def test_activate_extract_deviations_restores_generated_and_clears_pseudo(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from pdcheck_factory import pipeline_v2

    service = UiStepService(output_dir=tmp_path)
    study_id = "DEV-ACTIVATE"
    _seed_deviation_deps(study_id, tmp_path)
    _seed_manifest_active(
        service, study_id, **{"acrf-summary-text": "v1", "extract-rules": "v1"}
    )

    run_n = {"n": 0}

    def fake_extract(sid, output_dir, **kwargs):
        run_n["n"] += 1
        obj = {
            "schema_version": "1.0.0",
            "study_id": sid,
            "generated_at": f"2026-03-0{run_n['n']}T00:00:00+00:00",
            "deviations": [
                {
                    "deviation_id": f"dev-{run_n['n']:04d}",
                    "rule_id": "rule-001",
                    "text": f"Text {run_n['n']}",
                    "paragraph_refs": ["p1"],
                    "status": "pending",
                }
            ],
        }
        write_json(paths.local_deviations_parsed_json(sid, output_dir), obj)
        return obj

    def _init_review(sid, output_dir):
        parsed = read_json(paths.local_deviations_parsed_json(sid, output_dir))
        for path_fn in (
            paths.local_deviations_review_state,
            paths.local_deviations_review_generated_json,
            paths.local_deviations_validated_json,
        ):
            write_json(path_fn(sid, output_dir), parsed)

    monkeypatch.setattr(pipeline_v2, "step4_5_extract_deviations", fake_extract)
    monkeypatch.setattr(pipeline_v2, "initialize_review_states", _init_review)

    service.run_step(study_id, "extract-deviations", force=True, version_mode="new")
    service.run_step(study_id, "extract-deviations", force=True, version_mode="new")

    write_json(
        paths.local_pseudo_logic_review_state(study_id, tmp_path),
        {"schema_version": "1.0.0", "study_id": study_id, "items": [{"deviation_id": "dev-0002"}]},
    )

    service.set_active_step_artifact(study_id, "extract-deviations", "v1")
    generated = read_json(paths.local_deviations_review_generated_json(study_id, tmp_path))
    assert generated["deviations"][0]["deviation_id"] == "dev-0001"
    assert not paths.local_pseudo_logic_review_state(study_id, tmp_path).is_file()


def test_per_rule_dedup_creates_derived_version(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from pdcheck_factory import pipeline_v2, per_rule_dedup

    service = UiStepService(output_dir=tmp_path)
    study_id = "DEV-DEDUP"
    _seed_deviation_deps(study_id, tmp_path, rule_count=2)
    _seed_manifest_active(
        service,
        study_id,
        **{"acrf-summary-text": "v1", "extract-rules": "v1", "extract-deviations": "v1"},
    )

    source_versions = step_artifact_versions.resolve_deviation_source_versions(
        study_id, tmp_path, {"acrf-summary-text": "v1", "extract-rules": "v1"}
    )
    parsed = {
        "schema_version": "1.0.0",
        "study_id": study_id,
        "generated_at": "2026-01-01T00:00:00+00:00",
        "source_versions": source_versions,
        "deviations": [
            {
                "deviation_id": "dev-0001",
                "rule_id": "rule-001",
                "text": "Visit 1 labs missing",
                "paragraph_refs": ["p1"],
                "status": "pending",
            },
            {
                "deviation_id": "dev-0002",
                "rule_id": "rule-001",
                "text": "Visit 1 labs are missing",
                "paragraph_refs": ["p1"],
                "status": "pending",
            },
            {
                "deviation_id": "dev-0003",
                "rule_id": "rule-002",
                "text": "Consent after dosing",
                "paragraph_refs": ["p1"],
                "status": "pending",
            },
        ],
    }
    write_json(paths.local_deviations_parsed_json(study_id, tmp_path), parsed)
    for path_fn in (
        paths.local_deviations_review_state,
        paths.local_deviations_review_generated_json,
        paths.local_deviations_validated_json,
    ):
        write_json(path_fn(study_id, tmp_path), parsed)

    # Register parent version snapshot.
    step_artifact_versions.register_version_after_run(
        study_id,
        tmp_path,
        "extract-deviations",
        source_versions=source_versions,
        version_mode="new",
    )

    def fake_dedup(*, study_id, deviations, acrf_context=None, progress_callback=None):
        # Keep first of rule-001 pair; keep rule-002.
        kept = [deviations[0], deviations[2]]
        audit = [
            {
                "rule_id": "rule-001",
                "keep_deviation_id": "dev-0001",
                "merge_deviation_ids": ["dev-0002"],
                "rationale": "per-rule semantic duplicate",
            }
        ]
        return kept, audit

    monkeypatch.setattr(per_rule_dedup, "deduplicate_deviations_per_rule", fake_dedup)
    monkeypatch.setattr(
        pipeline_v2,
        "initialize_review_states",
        lambda sid, od: (
            write_json(
                paths.local_deviations_review_generated_json(sid, od),
                read_json(paths.local_deviations_parsed_json(sid, od)),
            ),
            write_json(
                paths.local_deviations_review_state(sid, od),
                read_json(paths.local_deviations_parsed_json(sid, od)),
            ),
            write_json(
                paths.local_deviations_validated_json(sid, od),
                read_json(paths.local_deviations_parsed_json(sid, od)),
            ),
        ),
    )

    # Mark extract-deviations done for status check.
    write_json(
        paths.local_deviations_parsed_json(study_id, tmp_path),
        read_json(paths.local_deviations_parsed_json(study_id, tmp_path)),
    )

    result = service.dedupe_deviations_per_rule(study_id)
    assert result["beforeCount"] == 3
    assert result["afterCount"] == 2
    assert result["removedCount"] == 1
    assert result["version"] == "v2"

    listed = step_artifact_versions.list_step_versions(
        study_id, tmp_path, "extract-deviations", active_version="v2"
    )
    assert len(listed["versions"]) == 2
    v2_meta = listed["versions"][1]
    assert v2_meta["derivedFrom"]["operation"] == "per-rule-dedup"
    assert v2_meta["derivedFrom"]["version"] == "v1"

    # Parent still restorable.
    service.set_active_step_artifact(study_id, "extract-deviations", "v1")
    restored = read_json(paths.local_deviations_parsed_json(study_id, tmp_path))
    assert len(restored["deviations"]) == 3


def test_per_rule_dedup_only_within_rule() -> None:
    from pdcheck_factory import per_rule_dedup

    deviations = [
        {
            "deviation_id": "dev-0001",
            "rule_id": "rule-001",
            "text": "Identical wording across rules should not merge",
            "paragraph_refs": ["p1"],
        },
        {
            "deviation_id": "dev-0002",
            "rule_id": "rule-002",
            "text": "Identical wording across rules should not merge",
            "paragraph_refs": ["p1"],
        },
    ]

    def never_duplicate(a, b, acrf_context=None):
        return False

    # Even with high text similarity, different rules stay separate when judge is unused
    # because we only cluster within a rule; same-rule would call judge.
    kept, audit = per_rule_dedup.deduplicate_deviations_per_rule(
        study_id="S",
        deviations=deviations,
        acrf_context=None,
    )
    assert len(kept) == 2
    assert audit == []


def test_per_rule_dedup_merges_within_rule(monkeypatch: pytest.MonkeyPatch) -> None:
    from pdcheck_factory import per_rule_dedup

    monkeypatch.setattr(
        per_rule_dedup,
        "_default_deviation_duplicate_judge",
        lambda a, b, acrf_context=None: True,
    )

    deviations = [
        {
            "deviation_id": "dev-0001",
            "rule_id": "rule-001",
            "text": "Visit 1 window missed by 2 days",
            "paragraph_refs": ["p1"],
        },
        {
            "deviation_id": "dev-0002",
            "rule_id": "rule-001",
            "text": "Visit 1 window missed by two days",
            "paragraph_refs": ["p1"],
        },
    ]
    kept, audit = per_rule_dedup.deduplicate_deviations_per_rule(
        study_id="S",
        deviations=deviations,
    )
    assert len(kept) == 1
    assert kept[0]["deviation_id"] == "dev-0001"
    assert audit[0]["merge_deviation_ids"] == ["dev-0002"]
    assert audit[0]["rule_id"] == "rule-001"

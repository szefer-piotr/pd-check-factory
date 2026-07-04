"""Shared pytest fixtures."""

from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _skip_deviation_postprocess_llm(monkeypatch: pytest.MonkeyPatch) -> None:
    from pdcheck_factory import deviation_classify, deviation_consolidate

    def _passthrough_classify(*, study_id, deviations, rules_by_id):
        del study_id, rules_by_id
        return deviations, []

    def _passthrough_consolidate(*, study_id, deviations):
        del study_id
        return deviations, []

    monkeypatch.setattr(deviation_classify, "classify_deviations", _passthrough_classify)
    monkeypatch.setattr(deviation_consolidate, "consolidate_deviations", _passthrough_consolidate)

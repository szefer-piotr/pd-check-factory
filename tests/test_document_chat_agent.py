"""Tests for Step 7 document-chat agent routing and mapping."""

from __future__ import annotations

from typing import Any, Dict, List
from unittest.mock import patch

import pytest

from pdcheck_factory.document_chat_agent import (
    AgentDecision,
    ChatAnswerDraft,
    DeviationDraft,
    Step7DocumentChatAgent,
    VerificationResult,
    _apply_router_guardrails,
    map_deviation_draft_to_row,
    run_step7_message,
)


def test_apply_router_guardrails_forces_full_document_for_structured_deviation() -> None:
    decision = AgentDecision(
        intent="structured_deviation",
        reference_sentences_sufficient=True,
        required_context="reference_sentences_only",
        action="answer_from_references",
        missing_information=[],
        reason="refs look enough",
        confidence=0.95,
    )
    guarded = _apply_router_guardrails(decision)
    assert guarded.required_context == "full_document"
    assert guarded.reference_sentences_sufficient is False
    assert guarded.action == "generate_deviation_from_full_document"


def test_apply_router_guardrails_low_confidence_escalates_to_full_document() -> None:
    decision = AgentDecision(
        intent="simple_answer",
        reference_sentences_sufficient=True,
        required_context="reference_sentences_only",
        action="answer_from_references",
        missing_information=[],
        reason="looks fine",
        confidence=0.5,
    )
    guarded = _apply_router_guardrails(decision)
    assert guarded.required_context == "full_document"
    assert guarded.action == "answer_from_full_document"


def test_map_deviation_draft_to_row() -> None:
    row = {
        "deviation_id": "dev-0001",
        "rule_id": "rule-001",
        "text": "Old text",
        "paragraph_refs": ["p1"],
        "data_support_note": "",
    }
    draft = DeviationDraft(
        protocol_requirement="Visit 4 on Day 14 ± 2.",
        deviation_condition="Visit 4 outside allowed window.",
        pseudo_logic_plain_english="flag if visit date outside day 12-16",
        cited_paragraph_refs=["p2", "p99"],
        required_datasets=["SV"],
        required_fields=["VISDAT"],
        assumptions=["SV.VISDAT available"],
        ambiguities=["Timezone not specified"],
        manual_review_needed=True,
        confidence=0.8,
    )
    updated = map_deviation_draft_to_row(
        row=row,
        draft=draft,
        valid_paragraph_ids={"p1", "p2"},
    )
    assert "Visit 4 outside allowed window" in updated["text"]
    assert updated["paragraph_refs"] == ["p2"]
    assert "Required datasets" in updated["data_support_note"]
    assert "Manual review needed" in updated["data_support_note"]


def test_run_step7_answer_does_not_mutate_row() -> None:
    decision = AgentDecision(
        intent="simple_answer",
        reference_sentences_sufficient=True,
        required_context="reference_sentences_only",
        action="answer_from_references",
        missing_information=[],
        reason="refs enough",
        confidence=0.9,
    )
    answer = ChatAnswerDraft(
        answer_text="Visit 4 is on Day 14 ± 2 days.",
        cited_paragraph_refs=["p1"],
        uncertainties=[],
    )
    verification = VerificationResult(
        supported=True,
        unsupported_claims=[],
        missing_caveats=[],
        corrected_summary=None,
        confidence=0.9,
    )
    calls: List[str] = []

    def fake_chat_json(**kwargs: Any) -> Dict[str, Any]:
        model = kwargs["response_model"]
        calls.append(model.__name__)
        if model is AgentDecision:
            return decision.model_dump(mode="json")
        if model is ChatAnswerDraft:
            return answer.model_dump(mode="json")
        if model is VerificationResult:
            return verification.model_dump(mode="json")
        raise AssertionError(f"unexpected model {model}")

    row = {
        "deviation_id": "dev-0001",
        "rule_id": "rule-001",
        "text": "Original",
        "paragraph_refs": ["p1"],
    }
    with patch("pdcheck_factory.document_chat_agent.llm.chat_json", side_effect=fake_chat_json):
        result = run_step7_message(
            study_id="S1",
            user_question="What is the visit window?",
            deviation_row=row,
            rule_row={"rule_id": "rule-001", "title": "T", "text": "Rule"},
            reference_sentences=[{"ref": "p1", "text": "Day 14 ± 2"}],
            full_document="p1: Day 14 ± 2",
            acrf_summary="{}",
            valid_paragraph_ids={"p1"},
        )

    assert result.response_type == "answer"
    assert result.updated_row is None
    assert "Visit 4" in result.assistant_message
    assert calls[0] == "AgentDecision"


def test_run_step7_structured_deviation_updates_row() -> None:
    decision = AgentDecision(
        intent="structured_deviation",
        reference_sentences_sufficient=False,
        required_context="full_document",
        action="generate_deviation_from_full_document",
        missing_information=["timing"],
        reason="needs full doc",
        confidence=0.88,
    )
    draft = DeviationDraft(
        deviation_condition="Antidepressant started before Visit 8.",
        cited_paragraph_refs=["p3"],
        pseudo_logic_plain_english="flag CM start before visit 8",
        manual_review_needed=True,
        confidence=0.7,
    )
    verification = VerificationResult(
        supported=False,
        unsupported_claims=["Assumes prohibition before Visit 8"],
        missing_caveats=["Prior medication distinction unclear"],
        corrected_summary=None,
        confidence=0.6,
    )

    def fake_chat_json(**kwargs: Any) -> Dict[str, Any]:
        model = kwargs["response_model"]
        if model is AgentDecision:
            return decision.model_dump(mode="json")
        if model is DeviationDraft:
            return draft.model_dump(mode="json")
        if model is VerificationResult:
            return verification.model_dump(mode="json")
        raise AssertionError(f"unexpected model {model}")

    row = {
        "deviation_id": "dev-0001",
        "rule_id": "rule-001",
        "text": "Original",
        "paragraph_refs": ["p1"],
        "status": "accepted",
    }
    with patch("pdcheck_factory.document_chat_agent.llm.chat_json", side_effect=fake_chat_json):
        result = run_step7_message(
            study_id="S1",
            user_question="Create programmed deviation for antidepressants before Visit 8",
            deviation_row=row,
            rule_row={"rule_id": "rule-001", "title": "Meds", "text": "Rule"},
            reference_sentences=[{"ref": "p1", "text": "after Visit 8"}],
            full_document="p3: full rule",
            acrf_summary="{}",
            valid_paragraph_ids={"p1", "p3"},
            also_generate_pseudo=True,
        )

    assert result.response_type == "revision"
    assert result.updated_row is not None
    assert "Antidepressant" in result.updated_row["text"]
    assert result.updated_pseudo is not None
    assert result.updated_pseudo["pseudo_logic"].startswith("flag CM")
    assert result.missing_caveats

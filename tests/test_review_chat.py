"""Unit tests for review_chat validate / apply (no LLM)."""

from __future__ import annotations

from typing import Any, Dict, List

from pdcheck_factory.review_chat.executor import apply_operations
from pdcheck_factory.review_chat.pipeline import run_review_chat_turn
from pdcheck_factory.review_chat.schemas import ChatOperation, TurnPlan
from pdcheck_factory.review_chat.validator import validate_turn_plan
from pdcheck_factory.review_chat.working_context import EntityStore, WorkingContext


def _dev_row(dev_id: str = "DEV-012", **kwargs: Any) -> Dict[str, Any]:
    row: Dict[str, Any] = {
        "deviation_id": dev_id,
        "rule_id": "R001",
        "text": "Long description of a missed assessment condition that is quite verbose.",
        "paragraph_refs": ["p1", "p2"],
        "status": "pending",
        "dm_comment": "",
        "data_support_note": "",
        "pd_spec_import": {
            "protocol_deviation_category": "",
            "protocol_deviation_sub_category": "",
            "manual_or_programmable": "Manual",
        },
    }
    row.update(kwargs)
    return row


def _rule(rule_id: str = "R001") -> Dict[str, Any]:
    return {
        "rule_id": rule_id,
        "title": "Visit windows",
        "text": "Subjects must attend Visit 4 on Day 14 ± 2 days.",
        "paragraph_refs": ["p1"],
    }


def test_explain_does_not_mutate() -> None:
    plan = TurnPlan(
        turn_type="explain",
        scope="active_selection",
        target_ids=["DEV-012"],
        user_expects_data_change=False,
        reason="Explain programmability",
        operations=[],
    )
    context = WorkingContext(
        domain="deviation",
        study_id="S1",
        list_revision=1,
        active_deviation_ids=["DEV-012"],
    )
    store = EntityStore.from_rows(deviations=[_dev_row()], rules=[_rule()])
    result = validate_turn_plan(plan, context, store)
    assert result.outcome == "execute"
    assert result.operations == []


def test_field_only_update_leaves_other_fields() -> None:
    rows = [_dev_row()]
    rules = [_rule()]
    original_category = rows[0]["pd_spec_import"]["protocol_deviation_category"]
    ops = [
        ChatOperation(
            operation="update_field",
            target_id="DEV-012",
            field="text",
            value="Shorter missed-assessment check.",
        )
    ]
    context = WorkingContext(domain="deviation", study_id="S1", list_revision=1)
    applied = apply_operations(operations=ops, context=context, deviations=rows, rules=rules)
    assert applied.mutated
    assert rows[0]["text"] == "Shorter missed-assessment check."
    assert rows[0]["paragraph_refs"] == ["p1", "p2"]
    assert rows[0]["pd_spec_import"]["protocol_deviation_category"] == original_category
    assert rows[0]["pd_spec_import"]["manual_or_programmable"] == "Manual"


def test_instruction_update_uses_resolver_only_for_text() -> None:
    rows = [_dev_row()]
    rules = [_rule()]
    ops = [
        ChatOperation(
            operation="update_field",
            target_id="DEV-012",
            field="text",
            instruction="Shorten without changing meaning",
        )
    ]
    context = WorkingContext(domain="deviation", study_id="S1")

    def resolver(field: str, current: str, instruction: str) -> str:
        assert field == "text"
        assert "missed" in current.lower() or "assessment" in current.lower()
        assert "Shorten" in instruction
        return "Short missed assessment."

    applied = apply_operations(
        operations=ops,
        context=context,
        deviations=rows,
        rules=rules,
        resolve_instruction=resolver,
    )
    assert applied.mutated
    assert rows[0]["text"] == "Short missed assessment."


def test_merge_these_two_without_selection_clarifies() -> None:
    plan = TurnPlan(
        turn_type="merge",
        scope="active_selection",
        target_ids=[],
        user_expects_data_change=True,
        operations=[ChatOperation(operation="merge", source_ids=[])],
        reason="Merge these two",
    )
    context = WorkingContext(domain="deviation", study_id="S1", active_deviation_ids=[])
    store = EntityStore.from_rows(deviations=[_dev_row("DEV-012"), _dev_row("DEV-019")], rules=[_rule()])
    result = validate_turn_plan(plan, context, store)
    assert result.outcome == "clarify"


def test_revision_mismatch_declines() -> None:
    plan = TurnPlan(
        turn_type="update",
        scope="explicit_ids",
        target_ids=["DEV-012"],
        user_expects_data_change=True,
        operations=[
            ChatOperation(operation="update_field", target_id="DEV-012", field="text", value="x")
        ],
    )
    context = WorkingContext(
        domain="deviation",
        study_id="S1",
        list_revision=5,
        expected_revision=4,
    )
    store = EntityStore.from_rows(deviations=[_dev_row()], rules=[_rule()])
    result = validate_turn_plan(plan, context, store)
    assert result.outcome == "decline"
    assert "revision" in result.reason.lower()


def test_invalid_category_declines() -> None:
    plan = TurnPlan(
        turn_type="update",
        scope="explicit_ids",
        target_ids=["DEV-012"],
        user_expects_data_change=True,
        operations=[
            ChatOperation(
                operation="set_category",
                target_id="DEV-012",
                category="Not A Real Category",
                sub_category="Nope",
            )
        ],
    )
    context = WorkingContext(domain="deviation", study_id="S1", list_revision=1)
    store = EntityStore.from_rows(deviations=[_dev_row()], rules=[_rule()])
    result = validate_turn_plan(plan, context, store)
    assert result.outcome == "decline"
    assert "taxonomy" in result.reason.lower() or "category" in result.reason.lower()


def test_set_programmability_to_programmable() -> None:
    rows = [_dev_row()]
    rows[0]["pd_spec_import"]["manual_or_programmable"] = "Partially programmable"
    rules = [_rule()]
    ops = [
        ChatOperation(
            operation="set_programmability",
            target_id="DEV-012",
            manual_or_programmable="Programmable",
        )
    ]
    context = WorkingContext(domain="deviation", study_id="S1", list_revision=1)
    applied = apply_operations(operations=ops, context=context, deviations=rows, rules=rules)
    assert applied.mutated
    assert rows[0]["pd_spec_import"]["manual_or_programmable"] == "Programmable"


def test_validate_set_programmability_accepts_partially_programmable() -> None:
    plan = TurnPlan(
        turn_type="update",
        scope="explicit_ids",
        target_ids=["DEV-012"],
        user_expects_data_change=True,
        operations=[
            ChatOperation(
                operation="set_programmability",
                target_id="DEV-012",
                manual_or_programmable="partially_programmable",
            )
        ],
    )
    context = WorkingContext(domain="deviation", study_id="S1", list_revision=1)
    store = EntityStore.from_rows(deviations=[_dev_row()], rules=[_rule()])
    result = validate_turn_plan(plan, context, store)
    assert result.outcome == "execute"
    assert result.operations[0].manual_or_programmable == "Partially programmable"


def test_manual_pseudo_logic_request_declines() -> None:
    plan = TurnPlan(
        turn_type="update",
        scope="explicit_ids",
        target_ids=["DEV-012"],
        user_expects_data_change=True,
        operations=[
            ChatOperation(
                operation="set_programmability",
                target_id="DEV-012",
                manual_or_programmable="Manual",
                instruction="Add programming logic / pseudo code",
            )
        ],
    )
    context = WorkingContext(domain="deviation", study_id="S1", list_revision=1)
    store = EntityStore.from_rows(deviations=[_dev_row()], rules=[_rule()])
    result = validate_turn_plan(plan, context, store)
    assert result.outcome == "decline"


def test_rules_question_keeps_rules_identical() -> None:
    rules: List[Dict[str, Any]] = [_rule("R001"), _rule("R002")]
    before = [dict(r) for r in rules]
    plan = TurnPlan(
        turn_type="answer",
        scope="none",
        user_expects_data_change=False,
        reason="Explain rule coverage",
    )
    turn = run_review_chat_turn(
        user_message="Why are there two visit window rules?",
        context=WorkingContext(domain="rules", study_id="S1", list_revision=2, apply=True),
        chat_history=[],
        deviations=[],
        rules=rules,
        entities_summary="[]",
        plan_override=plan,
        skip_llm_answer=True,
    )
    assert not turn.applied
    assert rules == before


def test_rules_field_update_one_field_only() -> None:
    rules = [_rule("R001")]
    plan = TurnPlan(
        turn_type="update",
        scope="explicit_ids",
        target_ids=["R001"],
        user_expects_data_change=True,
        operations=[
            ChatOperation(
                operation="update_field",
                target_id="R001",
                field="title",
                value="Visit window compliance",
            )
        ],
    )
    turn = run_review_chat_turn(
        user_message="Rename R001 title",
        context=WorkingContext(domain="rules", study_id="S1", list_revision=1, apply=True),
        chat_history=[],
        deviations=[],
        rules=rules,
        entities_summary="[]",
        plan_override=plan,
        skip_llm_answer=True,
    )
    assert turn.applied
    assert rules[0]["title"] == "Visit window compliance"
    assert rules[0]["text"] == "Subjects must attend Visit 4 on Day 14 ± 2 days."
    assert rules[0]["rule_id"] == "R001"


def test_multi_op_updates_in_order() -> None:
    rows = [_dev_row("DEV-012")]
    rules = [_rule()]
    plan = TurnPlan(
        turn_type="update",
        scope="explicit_ids",
        target_ids=["DEV-012"],
        user_expects_data_change=True,
        operations=[
            ChatOperation(operation="update_field", target_id="DEV-012", field="text", value="First"),
            ChatOperation(
                operation="update_field",
                target_id="DEV-012",
                field="dm_comment",
                value="Reviewed",
            ),
        ],
    )
    turn = run_review_chat_turn(
        user_message="Shorten and comment",
        context=WorkingContext(domain="deviation", study_id="S1", list_revision=1, apply=True),
        chat_history=[],
        deviations=rows,
        rules=rules,
        entities_summary="[]",
        plan_override=plan,
        skip_llm_answer=True,
    )
    assert turn.applied
    assert rows[0]["text"] == "First"
    assert rows[0]["dm_comment"] == "Reviewed"
    assert len(turn.apply_result.applied_ops) == 2


def test_merge_applies_and_records_sources() -> None:
    rows = [_dev_row("DEV-012"), _dev_row("DEV-019", text="Other wording", paragraph_refs=["p3"])]
    rules = [_rule()]
    plan = TurnPlan(
        turn_type="merge",
        scope="explicit_ids",
        target_ids=["DEV-012", "DEV-019"],
        user_expects_data_change=True,
        operations=[
            ChatOperation(
                operation="merge",
                keep_id="DEV-012",
                source_ids=["DEV-012", "DEV-019"],
            )
        ],
    )
    turn = run_review_chat_turn(
        user_message="Merge DEV-012 and DEV-019",
        context=WorkingContext(domain="deviation", study_id="S1", list_revision=1, apply=True),
        chat_history=[],
        deviations=rows,
        rules=rules,
        entities_summary="[]",
        plan_override=plan,
        skip_llm_answer=True,
    )
    assert turn.applied
    assert len(rows) == 1
    assert rows[0]["deviation_id"] == "DEV-012"
    assert "DEV-019" in rows[0]["merge_source_ids"]
    assert "p3" in rows[0]["paragraph_refs"]


def test_read_only_with_ops_declines() -> None:
    plan = TurnPlan(
        turn_type="explain",
        scope="active_selection",
        target_ids=["DEV-012"],
        user_expects_data_change=True,
        operations=[
            ChatOperation(operation="update_field", target_id="DEV-012", field="text", value="x")
        ],
    )
    context = WorkingContext(domain="deviation", study_id="S1", active_deviation_ids=["DEV-012"])
    store = EntityStore.from_rows(deviations=[_dev_row()], rules=[_rule()])
    result = validate_turn_plan(plan, context, store)
    assert result.outcome == "decline"
    assert "treated as a question" in result.reason.lower()
    assert "mark this check as manual" in result.reason.lower()


def test_decline_reply_separates_category_and_programmability() -> None:
    from pdcheck_factory.review_chat.response import compose_brief_reply
    from pdcheck_factory.review_chat.schemas import ValidationResult

    plan = TurnPlan(
        turn_type="explain",
        scope="active_selection",
        user_expects_data_change=True,
        operations=[
            ChatOperation(operation="set_programmability", target_id="DEV-012", manual_or_programmable="Manual")
        ],
    )
    validation = ValidationResult(
        outcome="decline",
        reason=(
            "I couldn't apply an edit because this turn was treated as a question "
            "instead of a data change. Rephrase as an explicit edit — for example "
            "'Mark this check as Manual', 'Set the PD category to …', or "
            "'Update status to accepted'."
        ),
    )
    reply = compose_brief_reply(plan=plan, validation=validation, domain="deviation")
    assert "treated as a question" in reply.lower()
    assert "You can instead:" in reply
    assert "PD category" in reply
    assert "Manual, Programmable, or To Review" in reply
    assert "set category or Manual" not in reply.lower()


def test_rules_unsupported_op_suggests_alternatives() -> None:
    plan = TurnPlan(
        turn_type="merge",
        scope="explicit_ids",
        target_ids=["DEV-012", "DEV-019"],
        user_expects_data_change=True,
        operations=[
            ChatOperation(
                operation="merge",
                keep_id="DEV-012",
                source_ids=["DEV-012", "DEV-019"],
            )
        ],
    )
    context = WorkingContext(domain="rules", study_id="S1", list_revision=1)
    store = EntityStore.from_rows(deviations=[_dev_row("DEV-012"), _dev_row("DEV-019")], rules=[_rule()])
    result = validate_turn_plan(plan, context, store)
    assert result.outcome == "decline"
    assert "not available in rules chat" in result.reason.lower()
    assert "you can instead" in result.reason.lower()


def test_decline_reply_includes_suggestions() -> None:
    from pdcheck_factory.review_chat.response import compose_brief_reply
    from pdcheck_factory.review_chat.schemas import ValidationResult

    plan = TurnPlan(turn_type="out_of_scope", reason="Cannot invent CRF mappings.")
    validation = ValidationResult(outcome="decline", reason="Cannot invent CRF mappings.")
    reply = compose_brief_reply(plan=plan, validation=validation, domain="deviation")
    assert "Cannot invent CRF mappings." in reply
    assert "You can instead:" in reply


def test_welcome_messages_describe_capabilities() -> None:
    from pdcheck_factory.review_chat.capabilities import welcome_message

    deviation = welcome_message("deviation")
    rules = welcome_message("rules")
    assert "Welcome" in deviation
    assert "merge" in deviation.lower()
    assert "Welcome" in rules
    assert "title" in rules.lower()
    assert "refinement chat" in rules.lower()

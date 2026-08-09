"""Orchestrate interpret → validate → apply → brief reply."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Mapping, Optional

from pdcheck_factory.review_chat.executor import (
    ApplyResult,
    apply_operations,
    resolve_field_instruction_via_llm,
)
from pdcheck_factory.review_chat.interpreter import compose_answer, interpret_turn
from pdcheck_factory.review_chat.response import compose_brief_reply
from pdcheck_factory.review_chat.schemas import READ_ONLY_TURN_TYPES, TurnPlan, ValidationResult
from pdcheck_factory.review_chat.validator import validate_turn_plan
from pdcheck_factory.review_chat.working_context import EntityStore, WorkingContext


@dataclass
class ReviewChatTurnResult:
    assistant_message: str
    plan: TurnPlan
    validation: ValidationResult
    apply_result: ApplyResult = field(default_factory=ApplyResult)
    applied: bool = False
    response_type: str = "answer"
    audit: Dict[str, Any] = field(default_factory=dict)


def run_review_chat_turn(
    *,
    user_message: str,
    context: WorkingContext,
    chat_history: List[Mapping[str, str]],
    deviations: List[Dict[str, Any]],
    rules: List[Dict[str, Any]],
    entities_summary: str,
    evidence_for_answer: str = "",
    valid_paragraph_ids: Optional[set[str]] = None,
    next_deviation_id_fn: Optional[Callable[[], str]] = None,
    next_rule_id_fn: Optional[Callable[[], str]] = None,
    plan_override: Optional[TurnPlan] = None,
    skip_llm_answer: bool = False,
) -> ReviewChatTurnResult:
    store = EntityStore.from_rows(
        deviations=deviations,
        rules=rules,
        valid_paragraph_ids=valid_paragraph_ids,
    )

    plan = plan_override or interpret_turn(
        user_message=user_message,
        context=context,
        chat_history=chat_history,
        entities_summary=entities_summary,
    )

    validation = validate_turn_plan(plan, context, store)
    apply_result = ApplyResult()
    applied = False
    answer_text = ""

    if validation.outcome == "execute" and validation.operations and context.apply:
        apply_result = apply_operations(
            operations=validation.operations,
            context=context,
            deviations=deviations,
            rules=rules,
            resolve_instruction=resolve_field_instruction_via_llm,
            next_deviation_id_fn=next_deviation_id_fn,
            next_rule_id_fn=next_rule_id_fn,
        )
        applied = apply_result.mutated
    elif validation.outcome == "execute" and not validation.operations:
        # Read-only / answer path
        if plan.turn_type in READ_ONLY_TURN_TYPES - {"clarify", "out_of_scope"} and not skip_llm_answer:
            answer_text = compose_answer(
                user_message=user_message,
                context=context,
                evidence=evidence_for_answer,
                turn_type=plan.turn_type,
            )

    assistant_message = compose_brief_reply(
        plan=plan,
        validation=validation,
        apply_result=apply_result if applied else None,
        answer_text=answer_text,
        domain=context.domain,
    )

    if validation.outcome == "clarify":
        response_type = "clarification"
    elif validation.outcome == "decline":
        response_type = "limitation"
    elif applied:
        response_type = "revision"
    else:
        response_type = "answer"

    audit = {
        "plan": plan.model_dump(mode="json"),
        "validation": validation.to_dict(),
        "applied_ops": list(apply_result.applied_ops),
        "response_type": response_type,
        "list_revision_seen": context.list_revision,
    }

    return ReviewChatTurnResult(
        assistant_message=assistant_message,
        plan=plan,
        validation=validation,
        apply_result=apply_result,
        applied=applied,
        response_type=response_type,
        audit=audit,
    )

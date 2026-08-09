"""Interpret user messages into typed TurnPlan objects."""

from __future__ import annotations

import json
from typing import List, Mapping

from pdcheck_factory import llm, llm_call_log
from pdcheck_factory.prompt_loader import load_prompt
from pdcheck_factory.review_chat.schemas import ChatAnswerDraft, TurnPlan
from pdcheck_factory.review_chat.working_context import WorkingContext


def _chat_process_prefix(domain: str) -> str:
    return "review-chat" if domain == "deviation" else "rules-chat"


def interpret_turn(
    *,
    user_message: str,
    context: WorkingContext,
    chat_history: List[Mapping[str, str]],
    entities_summary: str,
) -> TurnPlan:
    prompt_stem = (
        "review_chat_interpret_deviation"
        if context.domain == "deviation"
        else "review_chat_interpret_rules"
    )
    process = f"{_chat_process_prefix(context.domain)}.interpret"
    with llm_call_log.use_process(process):
        raw = llm.chat_json(
            system=load_prompt(f"{prompt_stem}_system"),
            user=load_prompt(f"{prompt_stem}_user").format(
                working_context=json.dumps(context.to_prompt_dict(), ensure_ascii=True),
                entities_summary=entities_summary,
                chat_history=_format_history(chat_history),
                user_message=user_message,
            ),
            response_model=TurnPlan,
            validator=lambda d: [],
            max_repairs=2,
            label=process,
        )
    return TurnPlan.model_validate(raw)


def compose_answer(
    *,
    user_message: str,
    context: WorkingContext,
    evidence: str,
    turn_type: str,
) -> str:
    process = f"{_chat_process_prefix(context.domain)}.answer"
    with llm_call_log.use_process(process):
        raw = llm.chat_json(
            system=load_prompt("review_chat_answer_system"),
            user=load_prompt("review_chat_answer_user").format(
                domain=context.domain,
                turn_type=turn_type,
                evidence=evidence or "(none)",
                user_message=user_message,
            ),
            response_model=ChatAnswerDraft,
            validator=lambda d: [],
            max_repairs=2,
            label=process,
        )
    draft = ChatAnswerDraft.model_validate(raw)
    return draft.answer_text.strip()


def _format_history(messages: List[Mapping[str, str]], *, limit: int = 10) -> str:
    if not messages:
        return "(none)"
    lines = []
    for msg in messages[-limit:]:
        role = str(msg.get("role", "user"))
        text = str(msg.get("text", "")).strip()
        lines.append(f"{role}: {text}")
    return "\n".join(lines)

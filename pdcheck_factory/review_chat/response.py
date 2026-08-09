"""Brief user-facing replies for review chat turns."""

from __future__ import annotations

from typing import Optional

from pdcheck_factory.review_chat.capabilities import enrich_limitation_message
from pdcheck_factory.review_chat.executor import ApplyResult
from pdcheck_factory.review_chat.schemas import TurnPlan, ValidationResult
from pdcheck_factory.review_chat.working_context import Domain


def compose_brief_reply(
    *,
    plan: TurnPlan,
    validation: ValidationResult,
    apply_result: Optional[ApplyResult] = None,
    answer_text: str = "",
    domain: Domain = "deviation",
) -> str:
    if validation.outcome == "clarify":
        return validation.reason.strip() or "Could you clarify your request?"
    if validation.outcome == "decline":
        return enrich_limitation_message(
            validation.reason.strip() or "I can't apply that change.",
            domain,
        )

    if apply_result and apply_result.summaries:
        body = " ".join(apply_result.summaries)
        if plan.reason.strip() and len(plan.reason.strip()) < 180:
            return f"{body} {plan.reason.strip()}".strip()
        return body

    if answer_text.strip():
        return answer_text.strip()

    if plan.turn_type in {"answer", "explain", "compare", "classify_programmability"}:
        return plan.reason.strip() or "Here is what I found."

    return plan.reason.strip() or "Done."

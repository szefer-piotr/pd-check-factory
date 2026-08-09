"""Welcome copy and limitation suggestions for review chats."""

from __future__ import annotations

from typing import Literal

from pdcheck_factory.review_chat.working_context import Domain

SUGGESTION_MARKER = "You can instead:"

DEVIATION_WELCOME_MESSAGE = """\
Welcome — this chat refines the open deviation.

Here you can:
• Ask questions, explanations, or comparisons about this check
• Rewrite or shorten the deviation text, data support note, or DM comment
• Update paragraph references or status (pending / to_review / accepted / rejected)
• Set category / sub-category (approved taxonomy only)
• Mark Manual, Programmable, or To Review
• Add, remove, or merge deviations (name the ids explicitly for merge)

Not available here: splitting one row into many, inventing programming logic for Manual checks, or bulk edits across a filter. If a request isn't supported, I'll say so and suggest what you can try next."""

RULES_WELCOME_MESSAGE = """\
Welcome — this chat works on the whole rules list.

Here you can:
• Ask questions or compare wording across rules
• Edit a rule's title, text, or paragraph references
• Add a new rule or remove a rule by id (for example R003)

Not available here: merging deviations, setting PD categories, or changing Manual/Programmable — use that deviation's refinement chat instead. If a request isn't supported, I'll say so and suggest another action."""


def welcome_message(domain: Domain) -> str:
    if domain == "rules":
        return RULES_WELCOME_MESSAGE
    return DEVIATION_WELCOME_MESSAGE


def limitation_suggestions(domain: Domain) -> str:
    if domain == "rules":
        return (
            f"{SUGGESTION_MARKER} ask about rules; edit title, text, or paragraph_refs; "
            "or add/remove a rule by id. For category, programmability, or merging "
            "deviations, open that deviation's refinement chat."
        )
    return (
        f"{SUGGESTION_MARKER} ask questions; edit text, notes, paragraph_refs, or status; "
        "set a PD category/sub-category; mark Manual, Programmable, or To Review; "
        "or add/remove/merge named deviation ids. Split and bulk filter-wide edits "
        "aren't supported here."
    )


def enrich_limitation_message(reason: str, domain: Domain) -> str:
    """Append actionable alternatives when a request is declined or out of scope."""
    text = (reason or "").strip() or "That isn't available in this chat."
    if SUGGESTION_MARKER.lower() in text.lower():
        return text
    return f"{text} {limitation_suggestions(domain)}".strip()


DeclineKind = Literal[
    "rules_op",
    "split",
    "bulk_filter",
    "field",
    "out_of_scope",
    "generic",
]


def decline_reason_with_suggestions(
    *,
    domain: Domain,
    kind: DeclineKind,
    detail: str = "",
) -> str:
    """Build a decline reason that always points the user at valid next steps."""
    if kind == "rules_op":
        base = detail or "That operation isn't available in rules chat."
    elif kind == "split":
        base = detail or (
            "Split is not supported in this phase. "
            "Specify field-level edits (for example rewrite text) instead."
        )
    elif kind == "bulk_filter":
        base = detail or (
            "Bulk changes across a filter are not applied automatically. Name specific ids."
        )
    elif kind == "field":
        base = detail or "That field isn't editable in this chat."
    elif kind == "out_of_scope":
        base = detail or "That request is outside the scope of this review chat."
    else:
        base = detail or "That isn't available in this chat."
    return enrich_limitation_message(base, domain)

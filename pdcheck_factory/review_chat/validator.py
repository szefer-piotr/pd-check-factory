"""Deterministic validation: execute / clarify / decline."""

from __future__ import annotations

import re
from typing import List

from pdcheck_factory.deviation_contract import pd_spec_field
from pdcheck_factory.pd_taxonomy import validate_category, validate_sub_category
from pdcheck_factory.review_chat.capabilities import decline_reason_with_suggestions
from pdcheck_factory.review_chat.schemas import (
    DEVIATION_EDITABLE_FIELDS,
    READ_ONLY_TURN_TYPES,
    RULE_EDITABLE_FIELDS,
    TEXT_INSTRUCTION_FIELDS,
    ChatOperation,
    TurnPlan,
    ValidationResult,
)
from pdcheck_factory.review_chat.working_context import EntityStore, WorkingContext

_STATUS_VALUES = frozenset({"pending", "accepted", "to_review", "rejected"})
_PARAGRAPH_REF_RE = re.compile(r"^p[0-9]+$")


def resolve_target_ids(plan: TurnPlan, context: WorkingContext) -> List[str]:
    explicit = [str(x).strip() for x in plan.target_ids if str(x).strip()]
    if plan.scope == "explicit_ids" and explicit:
        return explicit
    if plan.scope == "active_selection":
        if context.domain == "deviation":
            return list(context.active_deviation_ids) or (
                [context.last_viewed_deviation_id] if context.last_viewed_deviation_id else []
            )
        return list(context.active_rule_ids) or (
            [context.last_viewed_rule_id] if context.last_viewed_rule_id else []
        )
    if explicit:
        return explicit
    if context.domain == "deviation" and context.active_deviation_ids:
        return list(context.active_deviation_ids)
    if context.domain == "rules" and context.active_rule_ids:
        return list(context.active_rule_ids)
    return []


def validate_turn_plan(
    plan: TurnPlan,
    context: WorkingContext,
    store: EntityStore,
) -> ValidationResult:
    if context.expected_revision is not None and int(context.expected_revision) != int(context.list_revision):
        return ValidationResult(
            outcome="decline",
            reason=(
                f"List revision mismatch: expected {context.expected_revision}, "
                f"current is {context.list_revision}. Reload and retry."
            ),
        )

    if plan.ambiguities:
        return ValidationResult(
            outcome="clarify",
            reason="; ".join(plan.ambiguities) or plan.reason or "Please clarify your request.",
            resolved_target_ids=resolve_target_ids(plan, context),
        )

    if plan.turn_type == "clarify":
        return ValidationResult(
            outcome="clarify",
            reason=plan.reason.strip() or "Could you clarify which items and what should change?",
            resolved_target_ids=resolve_target_ids(plan, context),
        )

    if plan.turn_type == "out_of_scope":
        return ValidationResult(
            outcome="decline",
            reason=decline_reason_with_suggestions(
                domain=context.domain,
                kind="out_of_scope",
                detail=plan.reason.strip(),
            ),
        )

    if plan.turn_type in READ_ONLY_TURN_TYPES:
        if plan.operations and plan.user_expects_data_change:
            return ValidationResult(
                outcome="decline",
                reason=(
                    "I couldn't apply an edit because this turn was treated as a question "
                    "instead of a data change. Rephrase as an explicit edit — for example "
                    "'Mark this check as Manual', 'Set the PD category to …', or "
                    "'Update status to accepted'."
                ),
            )
        return ValidationResult(
            outcome="execute",
            reason=plan.reason or "Answer without modifying data.",
            operations=[],
            resolved_target_ids=resolve_target_ids(plan, context),
        )

    if not plan.user_expects_data_change:
        if plan.operations:
            return ValidationResult(
                outcome="decline",
                reason=(
                    "No data change was applied because the request was not treated as an "
                    "edit. Rephrase as an explicit change — for example "
                    "'Mark this check as Manual', 'Set the PD category to …', or "
                    "'Rewrite the deviation text to …'."
                ),
            )
        return ValidationResult(
            outcome="execute",
            reason=plan.reason or "No data change requested.",
            operations=[],
            resolved_target_ids=resolve_target_ids(plan, context),
        )

    if plan.turn_type == "split":
        return ValidationResult(
            outcome="decline",
            reason=decline_reason_with_suggestions(domain=context.domain, kind="split"),
        )

    if plan.scope == "all_matching_filter":
        return ValidationResult(
            outcome="decline",
            reason=decline_reason_with_suggestions(domain=context.domain, kind="bulk_filter"),
        )

    resolved = resolve_target_ids(plan, context)
    ops = list(plan.operations)

    if plan.turn_type in {"update", "remove", "merge", "add"} and not ops:
        # Synthesize minimal ops from turn_type when model omitted operations.
        if plan.turn_type == "remove" and resolved:
            ops = [ChatOperation(operation="remove", target_id=tid) for tid in resolved]
        elif plan.turn_type == "merge" and len(resolved) >= 2:
            ops = [
                ChatOperation(
                    operation="merge",
                    keep_id=resolved[0],
                    source_ids=list(resolved),
                    target_id=resolved[0],
                )
            ]
        elif plan.turn_type == "add":
            return ValidationResult(
                outcome="clarify",
                reason="To add an item, provide the required fields (rule_id/text for deviations, or title/text for rules).",
            )
        else:
            return ValidationResult(
                outcome="clarify",
                reason=plan.reason.strip()
                or "I understood an edit request but no concrete operations. Which field should change?",
                resolved_target_ids=resolved,
            )

    if not ops:
        return ValidationResult(
            outcome="clarify",
            reason="No concrete operations were provided. Which ids and fields should change?",
            resolved_target_ids=resolved,
        )

    # Fill target_id from resolved when single-target update ops omit it
    if len(resolved) == 1:
        only = resolved[0]
        filled: List[ChatOperation] = []
        for op in ops:
            data = op.model_dump(mode="json")
            if data["operation"] in {"update_field", "remove", "set_category", "set_programmability"} and not data.get(
                "target_id"
            ):
                data["target_id"] = only
            filled.append(ChatOperation.model_validate(data))
        ops = filled

    validated_ops: List[ChatOperation] = []
    for op in ops:
        result = _validate_operation(op, context, store, plan)
        if result.outcome != "execute":
            return result
        validated_ops.extend(result.operations)

    return ValidationResult(
        outcome="execute",
        reason=plan.reason.strip() or "Operations validated.",
        operations=validated_ops,
        resolved_target_ids=resolved,
    )


def _validate_operation(
    op: ChatOperation,
    context: WorkingContext,
    store: EntityStore,
    plan: TurnPlan,
) -> ValidationResult:
    kind = op.operation

    if kind == "split":
        return ValidationResult(
            outcome="decline",
            reason=decline_reason_with_suggestions(domain=context.domain, kind="split"),
        )

    if context.domain == "rules" and kind in {"merge", "set_category", "set_programmability"}:
        return ValidationResult(
            outcome="decline",
            reason=decline_reason_with_suggestions(
                domain="rules",
                kind="rules_op",
                detail=f"Operation '{kind}' is not available in rules chat.",
            ),
        )

    if kind == "update_field":
        return _validate_update_field(op, context, store)
    if kind == "add":
        return _validate_add(op, context, store)
    if kind == "remove":
        return _validate_remove(op, context, store, plan)
    if kind == "merge":
        return _validate_merge(op, store)
    if kind == "set_category":
        return _validate_set_category(op, store)
    if kind == "set_programmability":
        return _validate_set_programmability(op, store)
    return ValidationResult(outcome="decline", reason=f"Unknown operation '{kind}'.")


def _validate_update_field(
    op: ChatOperation,
    context: WorkingContext,
    store: EntityStore,
) -> ValidationResult:
    target_id = str(op.target_id or "").strip()
    field = str(op.field or "").strip()
    if not target_id:
        return ValidationResult(outcome="clarify", reason="Which item should be updated?")
    if not field:
        return ValidationResult(outcome="clarify", reason="Which field should be updated?")

    if context.domain == "deviation":
        if target_id not in store.deviations_by_id:
            return ValidationResult(outcome="decline", reason=f"Unknown deviation id '{target_id}'.")
        if field not in DEVIATION_EDITABLE_FIELDS:
            return ValidationResult(
                outcome="decline",
                reason=decline_reason_with_suggestions(
                    domain="deviation",
                    kind="field",
                    detail=(
                        f"Field '{field}' is not editable via chat. "
                        f"Editable: {', '.join(sorted(DEVIATION_EDITABLE_FIELDS))}."
                    ),
                ),
            )
    else:
        if target_id not in store.rules_by_id:
            return ValidationResult(outcome="decline", reason=f"Unknown rule id '{target_id}'.")
        if field not in RULE_EDITABLE_FIELDS:
            return ValidationResult(
                outcome="decline",
                reason=decline_reason_with_suggestions(
                    domain="rules",
                    kind="field",
                    detail=(
                        f"Field '{field}' is not editable via rules chat. "
                        f"Editable: {', '.join(sorted(RULE_EDITABLE_FIELDS))}."
                    ),
                ),
            )

    has_value = bool(str(op.value or "").strip())
    has_instruction = bool(str(op.instruction or "").strip())
    if not has_value and not has_instruction:
        return ValidationResult(
            outcome="clarify",
            reason=f"Provide a new value or an instruction for field '{field}' on '{target_id}'.",
        )
    if has_instruction and not has_value and field not in TEXT_INSTRUCTION_FIELDS:
        return ValidationResult(
            outcome="decline",
            reason=f"Instruction-based edits are only allowed for text-like fields, not '{field}'.",
        )
    if field == "status":
        status = str(op.value or "").strip().lower()
        if status not in _STATUS_VALUES:
            return ValidationResult(
                outcome="decline",
                reason=f"Invalid status '{op.value}'. Use pending, to_review, accepted, or rejected.",
            )
        return ValidationResult(
            outcome="execute",
            reason="ok",
            operations=[ChatOperation(operation="update_field", target_id=target_id, field="status", value=status)],
        )
    if field == "paragraph_refs" and has_value:
        refs = _parse_refs(op.value)
        bad = [r for r in refs if not _PARAGRAPH_REF_RE.match(r)]
        if bad:
            return ValidationResult(outcome="decline", reason=f"Invalid paragraph_refs: {', '.join(bad)}")
        if store.valid_paragraph_ids:
            missing = [r for r in refs if r not in store.valid_paragraph_ids]
            if missing:
                return ValidationResult(
                    outcome="decline",
                    reason=f"Unknown paragraph refs: {', '.join(missing)}",
                )
        return ValidationResult(
            outcome="execute",
            reason="ok",
            operations=[
                ChatOperation(
                    operation="update_field",
                    target_id=target_id,
                    field="paragraph_refs",
                    value=",".join(refs),
                    paragraph_refs=refs,
                )
            ],
        )
    return ValidationResult(outcome="execute", reason="ok", operations=[op])


def _validate_add(op: ChatOperation, context: WorkingContext, store: EntityStore) -> ValidationResult:
    if context.domain == "deviation":
        rule_id = str(op.rule_id or "").strip()
        text = str(op.text or "").strip()
        if not rule_id or not text:
            return ValidationResult(
                outcome="clarify",
                reason="Adding a deviation requires rule_id and text.",
            )
        if rule_id not in store.rules_by_id and store.rules_by_id:
            return ValidationResult(outcome="decline", reason=f"Unknown rule_id '{rule_id}'.")
        target_id = str(op.target_id or "").strip()
        if target_id and target_id in store.deviations_by_id:
            return ValidationResult(outcome="decline", reason=f"Deviation id '{target_id}' already exists.")
        return ValidationResult(outcome="execute", reason="ok", operations=[op])

    title = str(op.title or "").strip()
    text = str(op.text or "").strip()
    if not title or not text:
        return ValidationResult(outcome="clarify", reason="Adding a rule requires title and text.")
    target_id = str(op.target_id or op.rule_id or "").strip()
    if target_id and target_id in store.rules_by_id:
        return ValidationResult(outcome="decline", reason=f"Rule id '{target_id}' already exists.")
    return ValidationResult(outcome="execute", reason="ok", operations=[op])


def _validate_remove(
    op: ChatOperation,
    context: WorkingContext,
    store: EntityStore,
    plan: TurnPlan,
) -> ValidationResult:
    target_id = str(op.target_id or "").strip()
    if not target_id:
        return ValidationResult(outcome="clarify", reason="Which id should be removed?")
    if context.domain == "deviation":
        if target_id not in store.deviations_by_id:
            return ValidationResult(outcome="decline", reason=f"Unknown deviation id '{target_id}'.")
    else:
        if target_id not in store.rules_by_id:
            return ValidationResult(outcome="decline", reason=f"Unknown rule id '{target_id}'.")
    # Bulk remove guard: many removes without explicit ids in plan
    if plan.scope == "all_matching_filter":
        return ValidationResult(
            outcome="decline",
            reason="Bulk deletion requires explicit ids. Name each id to remove.",
        )
    return ValidationResult(outcome="execute", reason="ok", operations=[op])


def _validate_merge(op: ChatOperation, store: EntityStore) -> ValidationResult:
    source_ids = [str(x).strip() for x in (op.source_ids or []) if str(x).strip()]
    keep_id = str(op.keep_id or op.target_id or "").strip()
    if keep_id and keep_id not in source_ids:
        source_ids = [keep_id, *source_ids]
    if len(source_ids) < 2:
        return ValidationResult(
            outcome="clarify",
            reason="Merge requires at least two explicit deviation ids.",
        )
    if not keep_id:
        keep_id = source_ids[0]
    for sid in source_ids:
        if sid not in store.deviations_by_id:
            return ValidationResult(outcome="decline", reason=f"Unknown deviation id '{sid}'.")
    if keep_id not in source_ids:
        return ValidationResult(outcome="decline", reason=f"keep_id '{keep_id}' must be one of the source ids.")
    return ValidationResult(
        outcome="execute",
        reason="ok",
        operations=[
            ChatOperation(
                operation="merge",
                keep_id=keep_id,
                target_id=keep_id,
                source_ids=source_ids,
                text=str(op.text or ""),
                instruction=str(op.instruction or ""),
            )
        ],
    )


def _validate_set_category(op: ChatOperation, store: EntityStore) -> ValidationResult:
    target_id = str(op.target_id or "").strip()
    if not target_id or target_id not in store.deviations_by_id:
        return ValidationResult(outcome="decline", reason=f"Unknown deviation id '{target_id}'.")
    category = str(op.category or "").strip()
    sub = str(op.sub_category or "").strip()
    if category and not validate_category(category):
        return ValidationResult(
            outcome="decline",
            reason=f"Category '{category}' is not in the approved taxonomy.",
        )
    if (category or sub) and not validate_sub_category(category, sub) and sub:
        return ValidationResult(
            outcome="decline",
            reason=f"Sub-category '{sub}' is not valid for category '{category}'.",
        )
    return ValidationResult(outcome="execute", reason="ok", operations=[op])


def _validate_set_programmability(op: ChatOperation, store: EntityStore) -> ValidationResult:
    target_id = str(op.target_id or "").strip()
    if not target_id or target_id not in store.deviations_by_id:
        return ValidationResult(outcome="decline", reason=f"Unknown deviation id '{target_id}'.")
    value = str(op.manual_or_programmable or op.value or "").strip().lower()
    if value in {"manual_only", "manual"}:
        value = "Manual"
    elif value in {"programmable"}:
        value = "Programmable"
    elif value in {"partially programmable", "partially_programmable"}:
        value = "Partially programmable"
    elif value in {"to_review", "toreview", "to review"}:
        value = "To Review"
    else:
        # accept canonical casing from taxonomy-ish strings
        raw = str(op.manual_or_programmable or op.value or "").strip()
        if raw.lower() not in {
            "manual",
            "programmable",
            "manual_only",
            "partially programmable",
            "partially_programmable",
            "to review",
            "to_review",
        }:
            return ValidationResult(
                outcome="decline",
                reason="Programmability must be Manual, Programmable, Partially programmable, or To Review.",
            )
        value = raw

    row = store.deviations_by_id[target_id]
    # Decline inventing programming logic for manual
    instruction = str(op.instruction or "").lower()
    if value.lower().startswith("manual") and (
        "pseudo" in instruction or "programming logic" in instruction or "program" in instruction
    ):
        return ValidationResult(
            outcome="decline",
            reason="Manual checks must not receive programming logic via chat.",
        )
    # If currently manual and asking to populate logic without flipping to programmable
    current = pd_spec_field(row, "manual_or_programmable", default="").lower()
    if "manual" in current and ("pseudo" in instruction or "programming logic" in instruction):
        return ValidationResult(
            outcome="decline",
            reason="This check is manual-only; programming logic will not be generated in chat.",
        )

    return ValidationResult(
        outcome="execute",
        reason="ok",
        operations=[
            ChatOperation(
                operation="set_programmability",
                target_id=target_id,
                manual_or_programmable=value,
            )
        ],
    )


def _parse_refs(value: str) -> List[str]:
    parts = [p.strip() for p in str(value or "").replace(";", ",").split(",") if p.strip()]
    return parts

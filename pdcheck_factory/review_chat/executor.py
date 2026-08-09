"""Apply validated chat operations to in-memory review state (code executes)."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

from pdcheck_factory.deviation_contract import pd_spec_field
from pdcheck_factory.review_chat.schemas import ChatOperation, FieldValueDraft
from pdcheck_factory.review_chat.working_context import EntityStore, WorkingContext

_PARAGRAPH_REF_RE = re.compile(r"^p[0-9]+$")


ResolveInstructionFn = Callable[[str, str, str], str]
"""(field, current_value, instruction) -> new_value"""


@dataclass
class ApplyResult:
    applied_ops: List[Dict[str, Any]] = field(default_factory=list)
    summaries: List[str] = field(default_factory=list)
    mutated: bool = False
    primary_deviation_id: str = ""
    primary_rule_id: str = ""


def apply_operations(
    *,
    operations: List[ChatOperation],
    context: WorkingContext,
    deviations: List[Dict[str, Any]],
    rules: List[Dict[str, Any]],
    resolve_instruction: Optional[ResolveInstructionFn] = None,
    next_deviation_id_fn: Optional[Callable[[], str]] = None,
    next_rule_id_fn: Optional[Callable[[], str]] = None,
) -> ApplyResult:
    result = ApplyResult()
    if not operations:
        return result

    store = EntityStore.from_rows(deviations=deviations, rules=rules)

    for op in operations:
        if context.domain == "deviation":
            _apply_deviation_op(
                op,
                deviations=deviations,
                rules=rules,
                store=store,
                result=result,
                resolve_instruction=resolve_instruction,
                next_deviation_id_fn=next_deviation_id_fn,
            )
        else:
            _apply_rule_op(
                op,
                rules=rules,
                store=store,
                result=result,
                resolve_instruction=resolve_instruction,
                next_rule_id_fn=next_rule_id_fn,
            )

    result.mutated = bool(result.applied_ops)
    return result


def _apply_deviation_op(
    op: ChatOperation,
    *,
    deviations: List[Dict[str, Any]],
    rules: List[Dict[str, Any]],
    store: EntityStore,
    result: ApplyResult,
    resolve_instruction: Optional[ResolveInstructionFn],
    next_deviation_id_fn: Optional[Callable[[], str]],
) -> None:
    kind = op.operation
    if kind == "update_field":
        target_id = op.target_id
        row = _find_deviation(deviations, target_id)
        if row is None:
            return
        field = op.field
        value = str(op.value or "")
        if not value and op.instruction:
            current = _field_value(row, field)
            if resolve_instruction is None:
                raise ValueError("Instruction edits require resolve_instruction")
            value = resolve_instruction(field, current, op.instruction)
        if field == "paragraph_refs":
            refs = list(op.paragraph_refs) if op.paragraph_refs else _parse_refs(value)
            row["paragraph_refs"] = refs
        elif field == "text":
            row["text"] = value.strip()
        elif field == "data_support_note":
            row["data_support_note"] = value
        elif field == "dm_comment":
            row["dm_comment"] = value
        elif field == "status":
            row["status"] = value.strip().lower()
        else:
            return
        result.applied_ops.append({"operation": "update_field", "target_id": target_id, "field": field})
        result.summaries.append(f"Updated {field} on {target_id}.")
        result.primary_deviation_id = target_id
        store.deviations_by_id[target_id] = row
        return

    if kind == "add":
        new_id = str(op.target_id or "").strip() or (next_deviation_id_fn() if next_deviation_id_fn else "")
        if not new_id:
            raise ValueError("Cannot allocate deviation id")
        new_row = {
            "deviation_id": new_id,
            "rule_id": str(op.rule_id).strip(),
            "text": str(op.text).strip(),
            "paragraph_refs": list(op.paragraph_refs or []),
            "status": "pending",
            "dm_comment": "",
            "data_support_note": "",
        }
        deviations.append(new_row)
        store.deviations_by_id[new_id] = new_row
        result.applied_ops.append({"operation": "add", "target_id": new_id})
        result.summaries.append(f"Added deviation {new_id}.")
        result.primary_deviation_id = new_id
        return

    if kind == "remove":
        target_id = op.target_id
        before = len(deviations)
        deviations[:] = [r for r in deviations if str(r.get("deviation_id", "")) != target_id]
        if len(deviations) < before:
            store.deviations_by_id.pop(target_id, None)
            result.applied_ops.append({"operation": "remove", "target_id": target_id})
            result.summaries.append(f"Removed deviation {target_id}.")
        return

    if kind == "merge":
        keep_id = str(op.keep_id or op.target_id).strip()
        source_ids = [str(x).strip() for x in op.source_ids if str(x).strip()]
        keep_row = _find_deviation(deviations, keep_id)
        if keep_row is None:
            return
        all_refs: List[str] = list(keep_row.get("paragraph_refs") or [])
        for sid in source_ids:
            if sid == keep_id:
                continue
            other = store.deviations_by_id.get(sid)
            if other:
                for ref in other.get("paragraph_refs") or []:
                    if ref not in all_refs:
                        all_refs.append(ref)
        if op.text.strip():
            keep_row["text"] = op.text.strip()
        elif op.instruction and resolve_instruction:
            keep_row["text"] = resolve_instruction("text", str(keep_row.get("text", "")), op.instruction)
        keep_row["paragraph_refs"] = all_refs
        existing_sources = list(keep_row.get("merge_source_ids") or [])
        for sid in source_ids:
            if sid not in existing_sources:
                existing_sources.append(sid)
        keep_row["merge_source_ids"] = existing_sources
        keep_row["merge_action"] = "keep"
        remove_ids = [sid for sid in source_ids if sid != keep_id]
        deviations[:] = [r for r in deviations if str(r.get("deviation_id", "")) not in set(remove_ids)]
        for sid in remove_ids:
            store.deviations_by_id.pop(sid, None)
        store.deviations_by_id[keep_id] = keep_row
        result.applied_ops.append(
            {"operation": "merge", "keep_id": keep_id, "source_ids": source_ids, "removed_ids": remove_ids}
        )
        result.summaries.append(
            f"Merged {', '.join(source_ids)} into {keep_id}; removed {', '.join(remove_ids) or '(none)'}."
        )
        result.primary_deviation_id = keep_id
        return

    if kind == "set_category":
        target_id = op.target_id
        row = _find_deviation(deviations, target_id)
        if row is None:
            return
        nested = dict(row.get("pd_spec_import") or {}) if isinstance(row.get("pd_spec_import"), dict) else {}
        nested["protocol_deviation_category"] = str(op.category or "")
        nested["protocol_deviation_sub_category"] = str(op.sub_category or "")
        row["pd_spec_import"] = nested
        result.applied_ops.append({"operation": "set_category", "target_id": target_id})
        result.summaries.append(f"Updated category on {target_id}.")
        result.primary_deviation_id = target_id
        return

    if kind == "set_programmability":
        target_id = op.target_id
        row = _find_deviation(deviations, target_id)
        if row is None:
            return
        nested = dict(row.get("pd_spec_import") or {}) if isinstance(row.get("pd_spec_import"), dict) else {}
        nested["manual_or_programmable"] = str(op.manual_or_programmable or op.value or "")
        row["pd_spec_import"] = nested
        result.applied_ops.append({"operation": "set_programmability", "target_id": target_id})
        result.summaries.append(f"Set programmability on {target_id} to {nested['manual_or_programmable']}.")
        result.primary_deviation_id = target_id
        return


def _apply_rule_op(
    op: ChatOperation,
    *,
    rules: List[Dict[str, Any]],
    store: EntityStore,
    result: ApplyResult,
    resolve_instruction: Optional[ResolveInstructionFn],
    next_rule_id_fn: Optional[Callable[[], str]],
) -> None:
    kind = op.operation
    if kind == "update_field":
        target_id = op.target_id
        rule = _find_rule(rules, target_id)
        if rule is None:
            return
        field = op.field
        value = str(op.value or "")
        if not value and op.instruction:
            current = str(rule.get(field, "") if field != "paragraph_refs" else ",".join(rule.get("paragraph_refs") or []))
            if resolve_instruction is None:
                raise ValueError("Instruction edits require resolve_instruction")
            value = resolve_instruction(field, current, op.instruction)
        if field == "paragraph_refs":
            refs = list(op.paragraph_refs) if op.paragraph_refs else _parse_refs(value)
            rule["paragraph_refs"] = refs
        elif field in {"title", "text"}:
            rule[field] = value.strip()
        else:
            return
        result.applied_ops.append({"operation": "update_field", "target_id": target_id, "field": field})
        result.summaries.append(f"Updated {field} on {target_id}.")
        result.primary_rule_id = target_id
        store.rules_by_id[target_id] = rule
        return

    if kind == "add":
        new_id = str(op.target_id or op.rule_id or "").strip() or (next_rule_id_fn() if next_rule_id_fn else "")
        if not new_id:
            raise ValueError("Cannot allocate rule id")
        new_rule = {
            "rule_id": new_id,
            "title": str(op.title).strip(),
            "text": str(op.text).strip(),
            "paragraph_refs": list(op.paragraph_refs or []),
        }
        rules.append(new_rule)
        store.rules_by_id[new_id] = new_rule
        result.applied_ops.append({"operation": "add", "target_id": new_id})
        result.summaries.append(f"Added rule {new_id}.")
        result.primary_rule_id = new_id
        return

    if kind == "remove":
        target_id = op.target_id
        before = len(rules)
        rules[:] = [r for r in rules if str(r.get("rule_id", "")) != target_id]
        if len(rules) < before:
            store.rules_by_id.pop(target_id, None)
            result.applied_ops.append({"operation": "remove", "target_id": target_id})
            result.summaries.append(f"Removed rule {target_id}.")
        return


def _find_deviation(rows: List[Dict[str, Any]], deviation_id: str) -> Optional[Dict[str, Any]]:
    for row in rows:
        if str(row.get("deviation_id", "")) == deviation_id:
            return row
    return None


def _find_rule(rules: List[Dict[str, Any]], rule_id: str) -> Optional[Dict[str, Any]]:
    for rule in rules:
        if str(rule.get("rule_id", "")) == rule_id:
            return rule
    return None


def _field_value(row: Dict[str, Any], field: str) -> str:
    if field == "paragraph_refs":
        return ",".join(str(x) for x in (row.get("paragraph_refs") or []))
    if field == "manual_or_programmable":
        return pd_spec_field(row, "manual_or_programmable", default="")
    return str(row.get(field, "") or "")


def _parse_refs(value: str) -> List[str]:
    return [p.strip() for p in str(value or "").replace(";", ",").split(",") if p.strip() and _PARAGRAPH_REF_RE.match(p.strip())]


def resolve_field_instruction_via_llm(*, field: str, current_value: str, instruction: str) -> str:
    from pdcheck_factory import cost_usage, llm, llm_call_log
    from pdcheck_factory.prompt_loader import load_prompt

    bound = llm_call_log.current_bind()
    sess = cost_usage.current_session()
    prefix_src = bound.process or (sess.step if sess else None) or "review-chat"
    prefix = "rules-chat" if str(prefix_src).startswith("rules-chat") else "review-chat"
    process = f"{prefix}.field-edit"
    with llm_call_log.use_process(process):
        raw = llm.chat_json(
            system=load_prompt("review_chat_field_edit_system"),
            user=load_prompt("review_chat_field_edit_user").format(
                field=field,
                current_value=current_value or "(empty)",
                instruction=instruction,
            ),
            response_model=FieldValueDraft,
            validator=lambda d: [],
            max_repairs=2,
            label=process,
        )
    draft = FieldValueDraft.model_validate(raw)
    return draft.value.strip()

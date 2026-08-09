"""Structured turn plans and operations for review chat."""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class _StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


TurnType = Literal[
    "answer",
    "explain",
    "add",
    "update",
    "remove",
    "merge",
    "split",
    "compare",
    "classify_programmability",
    "clarify",
    "out_of_scope",
]

Scope = Literal["explicit_ids", "active_selection", "all_matching_filter", "none"]

OperationKind = Literal[
    "update_field",
    "add",
    "remove",
    "merge",
    "split",
    "set_category",
    "set_programmability",
]

ValidationOutcome = Literal["execute", "clarify", "decline"]

DEVIATION_EDITABLE_FIELDS = frozenset(
    {
        "text",
        "paragraph_refs",
        "data_support_note",
        "dm_comment",
        "status",
    }
)

RULE_EDITABLE_FIELDS = frozenset({"title", "text", "paragraph_refs"})

TEXT_INSTRUCTION_FIELDS = frozenset({"text", "title", "data_support_note", "dm_comment"})

READ_ONLY_TURN_TYPES = frozenset(
    {"answer", "explain", "compare", "classify_programmability", "clarify", "out_of_scope"}
)


class ChatOperation(_StrictModel):
    """Single typed mutation proposed by the interpreter (executed by code)."""

    operation: OperationKind
    target_id: str = ""
    field: str = ""
    value: str = ""
    instruction: str = ""
    source_ids: List[str] = Field(default_factory=list)
    keep_id: str = ""
    rule_id: str = ""
    title: str = ""
    text: str = ""
    paragraph_refs: List[str] = Field(default_factory=list)
    category: str = ""
    sub_category: str = ""
    manual_or_programmable: str = ""


class TurnPlan(_StrictModel):
    turn_type: TurnType
    scope: Scope = "none"
    target_ids: List[str] = Field(default_factory=list)
    operations: List[ChatOperation] = Field(default_factory=list)
    requested_fields: List[str] = Field(default_factory=list)
    ambiguities: List[str] = Field(default_factory=list)
    user_expects_data_change: bool = False
    reason: str = ""


class FieldValueDraft(_StrictModel):
    value: str = Field(min_length=1)


class ChatAnswerDraft(_StrictModel):
    answer_text: str = Field(min_length=1)


class ValidationResult:
    def __init__(
        self,
        *,
        outcome: ValidationOutcome,
        reason: str,
        operations: Optional[List[ChatOperation]] = None,
        resolved_target_ids: Optional[List[str]] = None,
    ) -> None:
        self.outcome = outcome
        self.reason = reason
        self.operations = list(operations or [])
        self.resolved_target_ids = list(resolved_target_ids or [])

    def to_dict(self) -> Dict[str, Any]:
        return {
            "outcome": self.outcome,
            "reason": self.reason,
            "operations": [op.model_dump(mode="json") for op in self.operations],
            "resolved_target_ids": list(self.resolved_target_ids),
        }

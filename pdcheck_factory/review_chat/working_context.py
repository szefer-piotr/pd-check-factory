"""Minimal chat working context (outside the transcript)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Literal, Mapping, Optional


Domain = Literal["deviation", "rules"]


@dataclass
class WorkingContext:
    domain: Domain
    study_id: str
    list_revision: int = 0
    expected_revision: Optional[int] = None
    active_deviation_ids: List[str] = field(default_factory=list)
    active_rule_ids: List[str] = field(default_factory=list)
    last_viewed_deviation_id: str = ""
    last_viewed_rule_id: str = ""
    current_filter: str = ""
    apply: bool = True

    def to_prompt_dict(self) -> Dict[str, Any]:
        return {
            "domain": self.domain,
            "list_revision": self.list_revision,
            "active_deviation_ids": list(self.active_deviation_ids),
            "active_rule_ids": list(self.active_rule_ids),
            "last_viewed_deviation_id": self.last_viewed_deviation_id,
            "last_viewed_rule_id": self.last_viewed_rule_id,
            "current_filter": self.current_filter,
        }


@dataclass
class EntityStore:
    """In-memory snapshot of rows/rules used for validation and apply planning."""

    deviations_by_id: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    rules_by_id: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    valid_paragraph_ids: set[str] = field(default_factory=set)

    @classmethod
    def from_rows(
        cls,
        *,
        deviations: Optional[List[Mapping[str, Any]]] = None,
        rules: Optional[List[Mapping[str, Any]]] = None,
        valid_paragraph_ids: Optional[set[str]] = None,
    ) -> "EntityStore":
        store = cls(valid_paragraph_ids=set(valid_paragraph_ids or set()))
        for row in deviations or []:
            dev_id = str(row.get("deviation_id", "")).strip()
            if dev_id:
                store.deviations_by_id[dev_id] = dict(row)
        for rule in rules or []:
            rule_id = str(rule.get("rule_id", "")).strip()
            if rule_id:
                store.rules_by_id[rule_id] = dict(rule)
        return store

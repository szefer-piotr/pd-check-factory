"""Orchestrated Step 7 document-chat agent: router → generator → verifier."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Literal, Optional, Set

from pydantic import BaseModel, ConfigDict, Field

from pdcheck_factory import llm
from pdcheck_factory.prompt_loader import load_prompt

_PARAGRAPH_REF_RE = re.compile(r"^p[0-9]+$")


class _StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AgentDecision(_StrictModel):
    intent: Literal[
        "simple_answer",
        "interpretation",
        "structured_deviation",
        "extract_multiple_deviations",
        "needs_clarification",
        "out_of_scope",
    ]
    reference_sentences_sufficient: bool
    required_context: Literal[
        "reference_sentences_only",
        "full_document",
        "clarification_from_user",
    ]
    action: Literal[
        "answer_from_references",
        "answer_from_full_document",
        "generate_deviation_from_full_document",
        "extract_multiple_deviations_from_full_document",
        "ask_clarifying_question",
        "refuse_or_explain_limitation",
    ]
    missing_information: List[str] = Field(default_factory=list)
    reason: str
    confidence: float = Field(ge=0.0, le=1.0)


class ChatAnswerDraft(_StrictModel):
    answer_text: str = Field(min_length=1)
    cited_paragraph_refs: List[str] = Field(default_factory=list)
    uncertainties: List[str] = Field(default_factory=list)


class DeviationDraft(_StrictModel):
    title: str = ""
    protocol_requirement: str = ""
    deviation_condition: str = Field(min_length=1)
    pseudo_logic_plain_english: str = ""
    cited_paragraph_refs: List[str] = Field(default_factory=list)
    required_datasets: List[str] = Field(default_factory=list)
    required_fields: List[str] = Field(default_factory=list)
    assumptions: List[str] = Field(default_factory=list)
    ambiguities: List[str] = Field(default_factory=list)
    manual_review_needed: bool = False
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)


class VerificationResult(_StrictModel):
    supported: bool
    unsupported_claims: List[str] = Field(default_factory=list)
    missing_caveats: List[str] = Field(default_factory=list)
    corrected_summary: Optional[str] = None
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)


@dataclass
class Step7ChatResult:
    response_type: Literal["answer", "revision", "clarification", "limitation"]
    assistant_message: str
    updated_row: Optional[Dict[str, Any]] = None
    updated_pseudo: Optional[Dict[str, Any]] = None
    decision: Optional[AgentDecision] = None
    verification: Optional[VerificationResult] = None
    missing_caveats: List[str] = field(default_factory=list)

    def to_audit_dict(self) -> Dict[str, Any]:
        audit: Dict[str, Any] = {
            "response_type": self.response_type,
        }
        if self.decision is not None:
            audit["decision"] = self.decision.model_dump(mode="json")
        if self.verification is not None:
            audit["verification"] = self.verification.model_dump(mode="json")
        if self.missing_caveats:
            audit["missing_caveats"] = list(self.missing_caveats)
        return audit


def _format_reference_sentences(sentences: List[Dict[str, str]]) -> str:
    if not sentences:
        return "(none)"
    lines = []
    for item in sentences:
        ref = str(item.get("ref", "")).strip()
        text = str(item.get("text", "")).strip()
        lines.append(f"{ref}: {text}" if ref else text)
    return "\n".join(lines)


def _format_chat_history(messages: List[Dict[str, str]], *, limit: int = 10) -> str:
    if not messages:
        return "(none)"
    lines = []
    for msg in messages[-limit:]:
        role = str(msg.get("role", "user"))
        text = str(msg.get("text", "")).strip()
        lines.append(f"{role}: {text}")
    return "\n".join(lines)


def _filter_paragraph_refs(refs: List[str], valid_ids: Set[str]) -> List[str]:
    out: List[str] = []
    for ref in refs:
        r = str(ref).strip()
        if _PARAGRAPH_REF_RE.match(r) and r in valid_ids:
            out.append(r)
    return out


def _apply_router_guardrails(decision: AgentDecision) -> AgentDecision:
    data = decision.model_dump(mode="json")
    intent = data["intent"]
    confidence = float(data.get("confidence", 0.0))

    if intent in {"structured_deviation", "interpretation", "extract_multiple_deviations"}:
        data["required_context"] = "full_document"
        data["reference_sentences_sufficient"] = False

    if intent == "structured_deviation":
        data["reference_sentences_sufficient"] = False
        if data["action"] in {"answer_from_references", "answer_from_full_document"}:
            data["action"] = "generate_deviation_from_full_document"

    if intent == "interpretation" and data["action"] == "answer_from_references":
        data["action"] = "answer_from_full_document"
        data["required_context"] = "full_document"

    if intent == "extract_multiple_deviations":
        data["action"] = "extract_multiple_deviations_from_full_document"
        data["required_context"] = "full_document"

    if confidence < 0.80 and data["action"] in {
        "answer_from_references",
        "answer_from_full_document",
        "generate_deviation_from_full_document",
        "extract_multiple_deviations_from_full_document",
    }:
        if data["action"] == "answer_from_references":
            data["action"] = "answer_from_full_document"
        data["required_context"] = "full_document"
        data["reference_sentences_sufficient"] = False

    if intent == "needs_clarification":
        data["action"] = "ask_clarifying_question"
        data["required_context"] = "clarification_from_user"

    if intent == "out_of_scope":
        data["action"] = "refuse_or_explain_limitation"

    return AgentDecision.model_validate(data)


def _build_data_support_note(draft: DeviationDraft) -> str:
    parts: List[str] = []
    if draft.required_datasets:
        parts.append("Required datasets: " + ", ".join(draft.required_datasets))
    if draft.required_fields:
        parts.append("Required fields: " + ", ".join(draft.required_fields))
    if draft.assumptions:
        parts.append("Assumptions:\n- " + "\n- ".join(draft.assumptions))
    if draft.ambiguities:
        parts.append("Ambiguities:\n- " + "\n- ".join(draft.ambiguities))
    if draft.manual_review_needed:
        parts.append("Manual review needed before programming.")
    return "\n\n".join(parts).strip()


def _deviation_text_from_draft(draft: DeviationDraft) -> str:
    condition = draft.deviation_condition.strip()
    requirement = draft.protocol_requirement.strip()
    if requirement and requirement not in condition:
        return f"Protocol requirement: {requirement}\n\nDeviation: {condition}"
    return condition


def map_deviation_draft_to_row(
    *,
    row: Dict[str, Any],
    draft: DeviationDraft,
    valid_paragraph_ids: Set[str],
) -> Dict[str, Any]:
    updated = dict(row)
    refs = _filter_paragraph_refs(draft.cited_paragraph_refs, valid_paragraph_ids)
    if not refs:
        refs = list(row.get("paragraph_refs", []))
    updated["text"] = _deviation_text_from_draft(draft)
    updated["paragraph_refs"] = refs
    note = _build_data_support_note(draft)
    if note:
        updated["data_support_note"] = note
    return updated


def map_deviation_draft_to_pseudo_item(
    *,
    draft: DeviationDraft,
    row: Dict[str, Any],
    rule: Dict[str, Any],
) -> Dict[str, Any]:
    pseudo = draft.pseudo_logic_plain_english.strip()
    if not pseudo:
        pseudo = "SELECT 1 WHERE 1=0 -- pseudo logic not drafted; generate separately"
    programmable = not draft.manual_review_needed
    note_parts: List[str] = []
    if draft.manual_review_needed:
        note_parts.append("Manual review recommended before programming.")
    if draft.ambiguities:
        note_parts.append("Ambiguities: " + "; ".join(draft.ambiguities[:3]))
    return {
        "deviation_id": row.get("deviation_id", ""),
        "rule_id": row.get("rule_id", ""),
        "rule_title": rule.get("title", ""),
        "pseudo_logic": pseudo,
        "programmable": programmable,
        "programmability_note": " ".join(note_parts).strip() or "Generated from document chat agent.",
        "status": str(row.get("status", "pending")),
        "dm_comment": str(row.get("dm_comment", "")),
    }


def build_reference_sentences(
    *,
    deviation_row: Dict[str, Any],
    rule_row: Dict[str, Any],
    paragraph_by_ref: Dict[str, Dict[str, Any]],
) -> List[Dict[str, str]]:
    seen: Set[str] = set()
    sentences: List[Dict[str, str]] = []

    def _add_ref(ref: str) -> None:
        r = str(ref).strip()
        if not r or r in seen:
            return
        seen.add(r)
        paragraph = paragraph_by_ref.get(r, {})
        text = str(
            paragraph.get("text")
            or paragraph.get("content")
            or paragraph.get("paragraph_text")
            or ""
        )
        sentences.append({"ref": r, "text": text})

    for ref in list(deviation_row.get("paragraph_refs", [])):
        _add_ref(str(ref))
    for ref in list(rule_row.get("paragraph_refs", [])):
        _add_ref(str(ref))
    return sentences


class Step7DocumentChatAgent:
    """Router → generator → verifier for Step 7 deviation drawer chat."""

    def route(
        self,
        *,
        study_id: str,
        user_question: str,
        deviation_row: Dict[str, Any],
        rule_row: Dict[str, Any],
        reference_sentences: List[Dict[str, str]],
        chat_history: List[Dict[str, str]],
    ) -> AgentDecision:
        raw = llm.chat_json(
            system=load_prompt("document_chat_router_system"),
            user=load_prompt("document_chat_router_user").format(
                study_id=study_id,
                deviation_id=str(deviation_row.get("deviation_id", "")),
                rule_id=str(deviation_row.get("rule_id", "")),
                deviation_text=str(deviation_row.get("text", "")),
                rule_title=str(rule_row.get("title", "")),
                rule_text=str(rule_row.get("text", "")),
                reference_sentences=_format_reference_sentences(reference_sentences),
                chat_history=_format_chat_history(chat_history),
                user_question=user_question,
            ),
            response_model=AgentDecision,
            validator=lambda d: [],
            max_repairs=2,
        )
        decision = AgentDecision.model_validate(raw)
        return _apply_router_guardrails(decision)

    def generate_answer(
        self,
        *,
        study_id: str,
        user_question: str,
        deviation_row: Dict[str, Any],
        rule_row: Dict[str, Any],
        reference_sentences: List[Dict[str, str]],
        full_document: str,
        acrf_summary: str,
        use_full_document: bool,
    ) -> ChatAnswerDraft:
        context_mode = "full_document" if use_full_document else "reference_sentences_only"
        full_block = (
            f"Full numbered protocol document:\n{full_document[:160000]}"
            if use_full_document
            else ""
        )
        raw = llm.chat_json(
            system=load_prompt("document_chat_answer_system"),
            user=load_prompt("document_chat_answer_user").format(
                study_id=study_id,
                context_mode=context_mode,
                deviation_text=str(deviation_row.get("text", "")),
                rule_title=str(rule_row.get("title", "")),
                rule_text=str(rule_row.get("text", "")),
                reference_sentences=_format_reference_sentences(reference_sentences),
                full_document_block=full_block,
                acrf_summary=acrf_summary[:50000],
                user_question=user_question,
            ),
            response_model=ChatAnswerDraft,
            validator=lambda d: [],
            max_repairs=2,
        )
        return ChatAnswerDraft.model_validate(raw)

    def generate_deviation_draft(
        self,
        *,
        study_id: str,
        user_question: str,
        deviation_row: Dict[str, Any],
        rule_row: Dict[str, Any],
        reference_sentences: List[Dict[str, str]],
        full_document: str,
        acrf_summary: str,
    ) -> DeviationDraft:
        raw = llm.chat_json(
            system=load_prompt("document_chat_deviation_system"),
            user=load_prompt("document_chat_deviation_user").format(
                study_id=study_id,
                deviation_id=str(deviation_row.get("deviation_id", "")),
                rule_id=str(deviation_row.get("rule_id", "")),
                deviation_text=str(deviation_row.get("text", "")),
                rule_title=str(rule_row.get("title", "")),
                rule_text=str(rule_row.get("text", "")),
                reference_sentences=_format_reference_sentences(reference_sentences),
                full_document=full_document[:160000],
                acrf_summary=acrf_summary[:50000],
                user_question=user_question,
            ),
            response_model=DeviationDraft,
            validator=lambda d: [],
            max_repairs=2,
        )
        return DeviationDraft.model_validate(raw)

    def verify(
        self,
        *,
        study_id: str,
        user_question: str,
        output_kind: str,
        evidence_pack: Dict[str, Any],
        draft_output: str,
    ) -> VerificationResult:
        raw = llm.chat_json(
            system=load_prompt("document_chat_verifier_system"),
            user=load_prompt("document_chat_verifier_user").format(
                study_id=study_id,
                output_kind=output_kind,
                user_question=user_question,
                evidence_pack=json.dumps(evidence_pack, ensure_ascii=False, indent=2)[:120000],
                draft_output=draft_output[:80000],
            ),
            response_model=VerificationResult,
            validator=lambda d: [],
            max_repairs=2,
        )
        return VerificationResult.model_validate(raw)

    def _format_answer_message(self, draft: ChatAnswerDraft) -> str:
        lines = [draft.answer_text.strip()]
        if draft.cited_paragraph_refs:
            lines.append("")
            lines.append("Sources: " + ", ".join(draft.cited_paragraph_refs))
        if draft.uncertainties:
            lines.append("")
            lines.append("Uncertainties:")
            lines.extend(f"- {u}" for u in draft.uncertainties)
        return "\n".join(lines).strip()

    def _append_verification_caveats(
        self, message: str, verification: VerificationResult
    ) -> tuple[str, List[str]]:
        caveats = list(verification.missing_caveats)
        if verification.unsupported_claims:
            caveats.extend(verification.unsupported_claims)
        if not caveats and verification.supported:
            return message, []
        extra_lines = ["", "Note: some claims may not be fully supported by the evidence."]
        if verification.corrected_summary:
            extra_lines.append(verification.corrected_summary.strip())
        for item in caveats[:8]:
            extra_lines.append(f"- {item}")
        return message + "\n".join(extra_lines), caveats

    def run(
        self,
        *,
        study_id: str,
        user_question: str,
        deviation_row: Dict[str, Any],
        rule_row: Dict[str, Any],
        reference_sentences: List[Dict[str, str]],
        full_document: str,
        acrf_summary: str,
        chat_history: Optional[List[Dict[str, str]]] = None,
        valid_paragraph_ids: Optional[Set[str]] = None,
        also_generate_pseudo: bool = False,
    ) -> Step7ChatResult:
        question = str(user_question or "").strip()
        if not question:
            return Step7ChatResult(
                response_type="clarification",
                assistant_message="Please enter a question or instruction.",
            )

        history = list(chat_history or [])
        valid_ids = valid_paragraph_ids or set()

        decision = self.route(
            study_id=study_id,
            user_question=question,
            deviation_row=deviation_row,
            rule_row=rule_row,
            reference_sentences=reference_sentences,
            chat_history=history,
        )

        if decision.action == "ask_clarifying_question":
            msg = decision.reason.strip() or "Could you clarify your request?"
            if decision.missing_information:
                msg += "\n\nMissing information:\n- " + "\n- ".join(
                    decision.missing_information
                )
            return Step7ChatResult(
                response_type="clarification",
                assistant_message=msg,
                decision=decision,
            )

        if decision.action == "refuse_or_explain_limitation":
            return Step7ChatResult(
                response_type="limitation",
                assistant_message=decision.reason.strip()
                or "This request is outside the scope of the available protocol context.",
                decision=decision,
            )

        use_full = decision.required_context == "full_document" or decision.action in {
            "answer_from_full_document",
            "generate_deviation_from_full_document",
            "extract_multiple_deviations_from_full_document",
        }

        evidence_pack: Dict[str, Any] = {
            "reference_sentences": reference_sentences,
            "current_deviation": {
                "deviation_id": deviation_row.get("deviation_id"),
                "text": deviation_row.get("text"),
                "paragraph_refs": deviation_row.get("paragraph_refs"),
            },
            "parent_rule": {
                "rule_id": rule_row.get("rule_id"),
                "title": rule_row.get("title"),
                "text": rule_row.get("text"),
            },
            "acrf_summary_excerpt": acrf_summary[:20000],
        }
        if use_full:
            evidence_pack["full_document_excerpt"] = full_document[:80000]

        if decision.action == "generate_deviation_from_full_document":
            draft = self.generate_deviation_draft(
                study_id=study_id,
                user_question=question,
                deviation_row=deviation_row,
                rule_row=rule_row,
                reference_sentences=reference_sentences,
                full_document=full_document,
                acrf_summary=acrf_summary,
            )
            updated_row = map_deviation_draft_to_row(
                row=deviation_row,
                draft=draft,
                valid_paragraph_ids=valid_ids,
            )
            draft_text = _deviation_text_from_draft(draft)
            verification = self.verify(
                study_id=study_id,
                user_question=question,
                output_kind="structured_deviation",
                evidence_pack=evidence_pack,
                draft_output=draft_text,
            )
            message = f"Updated deviation text based on your request.\n\n{draft_text}"
            message, caveats = self._append_verification_caveats(message, verification)

            updated_pseudo: Optional[Dict[str, Any]] = None
            if also_generate_pseudo and str(updated_row.get("status", "")) == "accepted":
                updated_pseudo = map_deviation_draft_to_pseudo_item(
                    draft=draft,
                    row=updated_row,
                    rule=rule_row,
                )

            return Step7ChatResult(
                response_type="revision",
                assistant_message=message,
                updated_row=updated_row,
                updated_pseudo=updated_pseudo,
                decision=decision,
                verification=verification,
                missing_caveats=caveats,
            )

        # answer paths (including extract_multiple as Q&A in v1)
        answer_draft = self.generate_answer(
            study_id=study_id,
            user_question=question,
            deviation_row=deviation_row,
            rule_row=rule_row,
            reference_sentences=reference_sentences,
            full_document=full_document,
            acrf_summary=acrf_summary,
            use_full_document=use_full,
        )
        message = self._format_answer_message(answer_draft)
        verification = self.verify(
            study_id=study_id,
            user_question=question,
            output_kind="answer",
            evidence_pack=evidence_pack,
            draft_output=answer_draft.answer_text,
        )
        message, caveats = self._append_verification_caveats(message, verification)

        return Step7ChatResult(
            response_type="answer",
            assistant_message=message,
            decision=decision,
            verification=verification,
            missing_caveats=caveats,
        )


_default_agent = Step7DocumentChatAgent()


def run_step7_message(
    *,
    study_id: str,
    user_question: str,
    deviation_row: Dict[str, Any],
    rule_row: Dict[str, Any],
    reference_sentences: List[Dict[str, str]],
    full_document: str,
    acrf_summary: str,
    chat_history: Optional[List[Dict[str, str]]] = None,
    valid_paragraph_ids: Optional[Set[str]] = None,
    also_generate_pseudo: bool = False,
) -> Step7ChatResult:
    """Module-level entry point for Step 7 chat."""
    return _default_agent.run(
        study_id=study_id,
        user_question=user_question,
        deviation_row=deviation_row,
        rule_row=rule_row,
        reference_sentences=reference_sentences,
        full_document=full_document,
        acrf_summary=acrf_summary,
        chat_history=chat_history,
        valid_paragraph_ids=valid_paragraph_ids,
        also_generate_pseudo=also_generate_pseudo,
    )

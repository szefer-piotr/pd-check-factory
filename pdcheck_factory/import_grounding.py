"""Ground imported PD spec deviations against protocol and aCRF artifacts."""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

from pdcheck_factory import llm, paths, study_artifact_sync, text_parse
from pdcheck_factory.deviation_contract import merge_canonical_updates, pd_spec_field
from pdcheck_factory.json_util import read_json, write_json
from pdcheck_factory.prompt_loader import load_prompt


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _tokenize(text: str) -> Set[str]:
    return {t for t in re.findall(r"[a-z0-9]{3,}", (text or "").lower()) if len(t) >= 3}


def retrieve_paragraph_candidates(
    *,
    deviation: Dict[str, Any],
    index_obj: Dict[str, Any],
    top_k: int = 25,
) -> List[Dict[str, Any]]:
    """Score paragraphs by keyword overlap with deviation text and PD categories."""
    query_parts = [
        str(deviation.get("text", "")),
        pd_spec_field(deviation, "protocol_deviation_category"),
        pd_spec_field(deviation, "protocol_deviation_sub_category"),
        pd_spec_field(deviation, "classification"),
    ]
    query_tokens = _tokenize(" ".join(query_parts))
    if not query_tokens:
        return []

    scored: List[tuple[int, Dict[str, Any]]] = []
    for paragraph in index_obj.get("paragraphs", []):
        pid = str(paragraph.get("paragraph_id", ""))
        ptext = str(paragraph.get("text", ""))
        ptokens = _tokenize(ptext)
        if not ptokens:
            continue
        overlap = len(query_tokens & ptokens)
        if overlap > 0:
            scored.append((overlap, paragraph))

    scored.sort(key=lambda item: item[0], reverse=True)
    return [p for _, p in scored[:top_k]]


def _format_paragraph_candidates(candidates: List[Dict[str, Any]]) -> str:
    lines: List[str] = []
    for p in candidates:
        pid = str(p.get("paragraph_id", ""))
        text = str(p.get("text", ""))[:1200]
        lines.append(f"{pid}: {text}")
    return "\n\n".join(lines)


def _filter_refs(refs: List[str], valid: Set[str]) -> List[str]:
    return [r for r in refs if r in valid]


def ground_imported_deviation(
    *,
    study_id: str,
    output_dir: Path,
    deviation: Dict[str, Any],
    index_obj: Dict[str, Any],
    acrf_summary: str,
) -> Dict[str, Any]:
    """Run LLM grounding for one imported deviation."""
    valid_ids = {str(p.get("paragraph_id", "")) for p in index_obj.get("paragraphs", [])}
    candidates = retrieve_paragraph_candidates(deviation=deviation, index_obj=index_obj)
    candidate_text = _format_paragraph_candidates(candidates)

    system = load_prompt("import_grounding_v2_system")
    user = load_prompt("import_grounding_v2_user").format(
        study_id=study_id,
        deviation_id=deviation.get("deviation_id", ""),
        protocol_deviation_category=pd_spec_field(deviation, "protocol_deviation_category"),
        protocol_deviation_sub_category=pd_spec_field(deviation, "protocol_deviation_sub_category"),
        classification=pd_spec_field(deviation, "classification"),
        deviation_text=deviation.get("text", ""),
        paragraph_candidates=candidate_text or "(no candidates)",
        acrf_summary=acrf_summary,
    )

    def _validate(reply: str) -> Optional[str]:
        if text_parse.BEGIN_GROUNDING not in (reply or ""):
            return "Must contain <<<BEGIN_GROUNDING>>> block."
        if not text_parse.parse_import_grounding_block(reply):
            return "Grounding block missing required fields."
        return None

    try:
        reply = llm.chat_text_repairs(
            system=system,
            user=user,
            validate_reply=_validate,
            max_repairs=2,
            label=f"import-ground-{deviation.get('deviation_id', '')}",
        )
        parsed = text_parse.parse_import_grounding_block(reply) or {}
    except Exception as exc:  # noqa: BLE001
        parsed = {
            "paragraph_refs": [],
            "data_support_note": "",
            "acrf_dataset_names": [],
            "grounding_error": str(exc),
        }

    refs = _filter_refs(list(parsed.get("paragraph_refs", [])), valid_ids)
    grounding_error = str(parsed.get("grounding_error", "") or "").strip()
    if grounding_error:
        refs = []
    elif not refs:
        grounding_error = "No valid protocol paragraph references after filtering"

    data_note = str(parsed.get("data_support_note", "") or "").strip()
    if not data_note and deviation.get("data_support_note"):
        data_note = str(deviation.get("data_support_note", ""))

    paragraph_by_ref = {str(p.get("paragraph_id", "")): p for p in index_obj.get("paragraphs", [])}
    supporting_sentences = []
    for ref in refs:
        paragraph = paragraph_by_ref.get(ref, {})
        supporting_sentences.append(
            {
                "ref": ref,
                "text": str(paragraph.get("text", "")),
            }
        )

    status = "to_review" if grounding_error else str(deviation.get("status") or "pending")
    updated = merge_canonical_updates(
        deviation,
        {
            "paragraph_refs": refs,
            "data_support_note": data_note,
            "status": status,
            "pd_spec_import": {"grounding_error": grounding_error},
        },
    )

    context_obj = {
        "schema_version": "1.0.0",
        "study_id": study_id,
        "deviation_id": deviation.get("deviation_id", ""),
        "generated_at": _iso_now(),
        "supporting_sentences": supporting_sentences,
        "protocol_grounding": {
            "paragraph_refs": refs,
            "candidate_count": len(candidates),
        },
        "acrf_grounding": {
            "dataset_names": list(parsed.get("acrf_dataset_names", [])),
            "data_support_note": data_note,
        },
        "pd_spec_metadata": {
            "protocol_deviation_category": pd_spec_field(deviation, "protocol_deviation_category"),
            "protocol_deviation_sub_category": pd_spec_field(deviation, "protocol_deviation_sub_category"),
            "classification": pd_spec_field(deviation, "classification"),
            "data_source": pd_spec_field(deviation, "data_source"),
        },
        "grounding_error": grounding_error,
    }
    context_path = paths.local_deviation_context_json(
        study_id, output_dir, str(deviation.get("deviation_id", ""))
    )
    context_path.parent.mkdir(parents=True, exist_ok=True)
    write_json(context_path, context_obj)
    study_artifact_sync.mirror_upload_path(study_id, output_dir, context_path)

    return updated


def build_deviations_state(
    *,
    study_id: str,
    deviations: List[Dict[str, Any]],
    import_version: str,
    source_type: str = "import",
    pd_spec_import_mode: str = "",
) -> Dict[str, Any]:
    state: Dict[str, Any] = {
        "schema_version": "1.1.0",
        "study_id": study_id,
        "generated_at": _iso_now(),
        "import_version": import_version,
        "source_type": source_type,
        "deviations": deviations,
    }
    mode = str(pd_spec_import_mode or "").strip()
    if mode:
        state["pd_spec_import_mode"] = mode
    return state

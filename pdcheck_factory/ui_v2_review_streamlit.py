"""Streamlit UI for Pipeline V2 deviation review and pseudo-logic generation."""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any, Dict, List

import streamlit as st

from pdcheck_factory import paths, pipeline_v2
from pdcheck_factory.json_util import read_json, write_json


def _inject_compact_styles() -> None:
    st.markdown(
        """
<style>
div.block-container {padding-top: 1rem; padding-bottom: 1rem; max-width: 98%;}
h1 {font-size: 1.4rem;}
div[data-testid="stVerticalBlock"] > div:has(> div[data-testid="stHorizontalBlock"]) {gap: 0.4rem;}
div[data-testid="stTextArea"] textarea, div[data-testid="stTextInput"] input {
  font-size: 0.82rem;
  line-height: 1.2;
}
div[data-testid="stSelectbox"] label, div[data-testid="stTextInput"] label, div[data-testid="stTextArea"] label {
  font-size: 0.75rem;
}
[data-testid="stMarkdownContainer"] p {margin: 0.15rem 0;}
.row-sep {border-top: 1px solid #d9d9d9; margin: 0.35rem 0 0.25rem 0;}
.compact-head {font-size: 0.74rem; font-weight: 600; color: #4b5563;}
</style>
        """,
        unsafe_allow_html=True,
    )


def _rules_by_id(study_id: str, output_dir: Path) -> Dict[str, Dict[str, Any]]:
    obj = read_json(paths.local_rules_parsed_json(study_id, output_dir))
    return {str(r.get("rule_id", "")): r for r in obj.get("rules", [])}


def _paragraphs_by_id(study_id: str, output_dir: Path) -> Dict[str, str]:
    obj = read_json(paths.local_protocol_paragraph_index_json(study_id, output_dir))
    out: Dict[str, str] = {}
    for p in obj.get("paragraphs", []):
        pid = str(p.get("paragraph_id", ""))
        text = str(p.get("text", "")).strip()
        if pid:
            out[pid] = text
    return out


def _rule_tooltip(rule: Dict[str, Any]) -> str:
    if not rule:
        return "Rule details unavailable (rule_id not found in rules artifact)."
    return (
        f"{rule.get('rule_id', '')} - {rule.get('title', '')}\n\n"
        f"{rule.get('text', '')[:1200]}"
    ).strip()


def _paragraph_tooltip(refs: List[str], paragraphs: Dict[str, str]) -> str:
    if not refs:
        return "No protocol paragraph refs attached to this deviation."
    chunks: List[str] = []
    for ref in refs:
        chunks.append(f"{ref}: {paragraphs.get(ref, '(missing in paragraph index)')[:600]}")
    return "\n\n".join(chunks)[:3000]


def _load_state(study_id: str, output_dir: Path) -> Dict[str, Any]:
    path = paths.local_deviations_review_state(study_id, output_dir)
    if not path.is_file():
        raise FileNotFoundError(f"Missing review state: {path}")
    return read_json(path)


def _persist_state(study_id: str, output_dir: Path, state_obj: Dict[str, Any], audit_obj: Dict[str, Any]) -> None:
    write_json(paths.local_deviations_review_state(study_id, output_dir), state_obj)
    write_json(paths.local_deviations_validated_json(study_id, output_dir), state_obj)
    write_json(paths.local_deviations_review_audit_json(study_id, output_dir), audit_obj)


def _load_pseudo_state(study_id: str, output_dir: Path) -> Dict[str, Any]:
    path = paths.local_pseudo_logic_review_state(study_id, output_dir)
    if path.is_file():
        return read_json(path)
    return {
        "schema_version": "1.0.0",
        "study_id": study_id,
        "generated_at": "",
        "items": [],
    }


def _save_pseudo_state(study_id: str, output_dir: Path, pseudo_obj: Dict[str, Any]) -> None:
    write_json(paths.local_pseudo_logic_review_state(study_id, output_dir), pseudo_obj)
    write_json(paths.local_pseudo_logic_validated_json(study_id, output_dir), pseudo_obj)


def _upsert_pseudo_item(pseudo_obj: Dict[str, Any], item: Dict[str, Any]) -> None:
    items = list(pseudo_obj.get("items", []))
    by_id = {str(it.get("deviation_id", "")): it for it in items}
    dev_id = str(item.get("deviation_id", ""))
    if dev_id in by_id:
        # Preserve existing review metadata while updating generated logic content.
        cur = by_id[dev_id]
        cur["rule_id"] = item.get("rule_id", cur.get("rule_id", ""))
        cur["rule_title"] = item.get("rule_title", cur.get("rule_title", ""))
        cur["pseudo_logic"] = item.get("pseudo_logic", cur.get("pseudo_logic", ""))
    else:
        items.append(item)
    pseudo_obj["items"] = items


def render_app(*, study_id: str, output_dir: Path) -> None:
    st.set_page_config(page_title="PD Check V2 Review", layout="wide")
    _inject_compact_styles()
    st.title(f"Study {study_id} — V2 Deviation Review")

    rules = _rules_by_id(study_id, output_dir)
    paragraphs = _paragraphs_by_id(study_id, output_dir)
    state_obj = _load_state(study_id, output_dir)
    rows = list(state_obj.get("deviations", []))
    pseudo_obj = _load_pseudo_state(study_id, output_dir)
    pseudo_by_dev = {str(it.get("deviation_id", "")): it for it in pseudo_obj.get("items", [])}

    st.caption(
        "Excel-style compact grid. Hover the ? tooltip icons on Rule/Refs/Status/Comment for "
        "rule text and protocol paragraph reference previews."
    )
    run_revision_cycle = st.checkbox("Run LLM revision cycle for rows marked to_review", value=True)

    col_apply, col_bulk = st.columns([1, 1])
    with col_apply:
        apply_clicked = st.button("Apply review updates", use_container_width=True)
    with col_bulk:
        bulk_logic_clicked = st.button("Generate Logic for All deviations", use_container_width=True)

    h1, h2, h3, h4, h5, h6 = st.columns([1.0, 1.4, 3.0, 1.2, 2.2, 1.2])
    h1.markdown('<div class="compact-head">Deviation</div>', unsafe_allow_html=True)
    h2.markdown('<div class="compact-head">Rule</div>', unsafe_allow_html=True)
    h3.markdown('<div class="compact-head">Deviation text</div>', unsafe_allow_html=True)
    h4.markdown('<div class="compact-head">Refs</div>', unsafe_allow_html=True)
    h5.markdown('<div class="compact-head">Status + DM comment</div>', unsafe_allow_html=True)
    h6.markdown('<div class="compact-head">Pseudo logic</div>', unsafe_allow_html=True)

    updates: Dict[str, Dict[str, str]] = {}
    for row in rows:
        dev_id = str(row.get("deviation_id", ""))
        rule = rules.get(str(row.get("rule_id", "")), {})
        refs = list(row.get("paragraph_refs", []))
        st.markdown('<div class="row-sep"></div>', unsafe_allow_html=True)
        c_dev, c_rule, c_text, c_refs, c_review, c_logic = st.columns([1.0, 1.4, 3.0, 1.2, 2.2, 1.2])
        with c_dev:
            st.markdown(f"**{dev_id}**")
        with c_rule:
            st.markdown(f"`{row.get('rule_id', '')}`")
            st.caption((rule.get("title", "") or "(untitled rule)")[:100])
        with c_text:
            st.text_area(
                "Deviation text",
                value=str(row.get("text", "")),
                key=f"text_{dev_id}",
                height=76,
                disabled=True,
                help=_rule_tooltip(rule),
                label_visibility="collapsed",
            )
        with c_refs:
            refs_text = ", ".join(refs) if refs else "(none)"
            st.text_input(
                "Paragraph refs",
                value=refs_text,
                key=f"refs_{dev_id}",
                disabled=True,
                help=_paragraph_tooltip(refs, paragraphs),
                label_visibility="collapsed",
            )
        with c_review:
            status = st.selectbox(
                "Status",
                ["pending", "accepted", "to_review", "rejected"],
                index=["pending", "accepted", "to_review", "rejected"].index(
                    str(row.get("status", "pending"))
                    if str(row.get("status", "pending")) in {"pending", "accepted", "to_review", "rejected"}
                    else "pending"
                ),
                key=f"status_{dev_id}",
                help=_rule_tooltip(rule),
                label_visibility="collapsed",
            )
            dm_comment = st.text_input(
                "DM comment",
                value=str(row.get("dm_comment", "")),
                key=f"comment_{dev_id}",
                help=_paragraph_tooltip(refs, paragraphs),
                label_visibility="collapsed",
                placeholder="DM comment (required for to_review)",
            )
        with c_logic:
            if st.button("Generate", key=f"logic_{dev_id}", use_container_width=True):
                item = pipeline_v2.generate_pseudo_logic_for_deviation(
                    study_id=study_id,
                    output_dir=output_dir,
                    deviation=row,
                    rule_by_id=rules,
                )
                _upsert_pseudo_item(pseudo_obj, item)
                _save_pseudo_state(study_id, output_dir, pseudo_obj)
                st.success(f"Generated logic for {dev_id}")
                st.rerun()

        if dev_id in pseudo_by_dev:
            pseudo_item = pseudo_by_dev[dev_id]
            st.code(str(pseudo_item.get("pseudo_logic", "")), language="sql")
            prog = pseudo_item.get("programmable")
            note = str(pseudo_item.get("programmability_note", ""))
            if prog is not None:
                st.caption(f"Programmable: `{bool(prog)}`")
            if note:
                st.caption(f"Programmability note: {note}")
        updates[dev_id] = {"status": status, "dm_comment": dm_comment}

    if apply_clicked:
        new_state, audit = pipeline_v2.apply_deviation_review_updates(
            study_id=study_id,
            output_dir=output_dir,
            state_obj=state_obj,
            updates=updates,
            run_revision_cycle=run_revision_cycle,
        )
        _persist_state(study_id, output_dir, new_state, audit)
        st.success(f"Applied updates: {audit.get('updated_rows', 0)}; revised: {audit.get('revised_rows', 0)}")

    if bulk_logic_clicked:
        generated = 0
        for row in rows:
            item = pipeline_v2.generate_pseudo_logic_for_deviation(
                study_id=study_id,
                output_dir=output_dir,
                deviation=row,
                rule_by_id=rules,
            )
            _upsert_pseudo_item(pseudo_obj, item)
            generated += 1
        _save_pseudo_state(study_id, output_dir, pseudo_obj)
        st.success(f"Generated pseudo logic for {generated} deviations.")


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Streamlit V2 review app.")
    parser.add_argument("--study-id", required=True)
    parser.add_argument("--output-dir", default="output")
    return parser.parse_args()


def main() -> None:
    args = _parse_args()
    render_app(study_id=args.study_id, output_dir=Path(args.output_dir))


if __name__ == "__main__":
    main()

"""Streamlit UI for full Pipeline V2 workflow and review loops."""

from __future__ import annotations

import argparse
import io
import os
import re
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Literal, Optional, Tuple

import streamlit as st

from pdcheck_factory import paths
from pdcheck_factory import ui_test_mode
from pdcheck_factory import ui_v2_wizard_model as wiz
from pdcheck_factory.json_util import read_json, write_json
from pdcheck_factory.ui_test_mode import UiModeConfig

_STAGE_FEEDBACK_KEY = "_pdcheck_last_stage"
_WIZ_SELECTED_STEP = "_pdcheck_wiz_selected_step"


def _inject_compact_styles() -> None:
    st.markdown(
        """
<style>
div.block-container {padding-top: 0.5rem; padding-bottom: 0.6rem; max-width: 99%;}
h1 {font-size: 1.4rem;}
div[data-testid="stVerticalBlock"] > div:has(> div[data-testid="stHorizontalBlock"]) {gap: 0.2rem;}
div[data-testid="stTextArea"] textarea, div[data-testid="stTextInput"] input {
  font-size: 0.78rem;
  line-height: 1.2;
  min-height: 1.8rem;
}
div[data-testid="stSelectbox"] label, div[data-testid="stTextInput"] label, div[data-testid="stTextArea"] label {
  font-size: 0.7rem;
}
[data-testid="stMarkdownContainer"] p {margin: 0.05rem 0;}
.row-sep {border-top: 1px solid #e5e7eb; margin: 0.12rem 0 0.08rem 0;}
.compact-head {font-size: 0.68rem; font-weight: 700; color: #4b5563;}
button[kind="secondary"] {padding-top: 0.08rem; padding-bottom: 0.08rem;}
.readonly-cell {
  font-size: 0.78rem;
  line-height: 1.2;
  min-height: 1.8rem;
  border: 1px solid rgba(49, 51, 63, 0.2);
  border-radius: 0.4rem;
  padding: 0.26rem 0.5rem;
  background: rgba(250, 250, 250, 0.04);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: help;
}
.wiz-line-complete {opacity: 0.95;}
.wiz-line-ready {opacity: 1;}
.wiz-line-blocked {opacity: 0.55;}
</style>
        """,
        unsafe_allow_html=True,
    )


def _status_badge(status: str) -> str:
    if status == "complete":
        return "complete"
    if status == "ready":
        return "ready"
    return "blocked"


def _artifact_exists(path: Path, kind: str = "file") -> bool:
    if kind == "dir":
        return path.is_dir()
    if kind == "dir_nonempty":
        return path.is_dir() and any(path.iterdir())
    return path.is_file()


def _required_env_missing(names: List[str]) -> List[str]:
    return [name for name in names if not os.getenv(name)]


def _capture_run(action: Callable[[], Any]) -> tuple[bool, str, str]:
    out = io.StringIO()
    err = io.StringIO()
    try:
        with redirect_stdout(out), redirect_stderr(err):
            action()
    except KeyboardInterrupt:
        raise
    except BaseException as ex:  # pragma: no cover — includes SystemExit from failed CLI paths
        return False, out.getvalue(), f"{err.getvalue()}\n{type(ex).__name__}: {ex}".strip()
    return True, out.getvalue(), err.getvalue()


def _ui_mode_config(data_mode: Literal["real", "test", "mixed"], fixtures_dir: Path) -> UiModeConfig:
    return UiModeConfig(mode=data_mode, fixtures_dir=fixtures_dir)


def _step_contracts(study_id: str, output_dir: Path) -> List[Dict[str, Any]]:
    sections_toc_dir = (
        paths.local_extraction_layout(study_id, "acrf", output_dir)
        / "rendered"
        / "sections_toc"
    )
    return [
        {
            "id": "extract",
            "title": "Data Prep: Extract PDFs",
            "requires": [],
            "produces": [
                (
                    paths.local_extraction_opendataloader(study_id, "protocol", output_dir)
                    / "rendered"
                    / "source.md",
                    "file",
                ),
                (
                    paths.local_extraction_layout(study_id, "acrf", output_dir)
                    / "rendered"
                    / "source.md",
                    "file",
                ),
            ],
        },
        {
            "id": "split_toc",
            "title": "Data Prep: Split aCRF TOC",
            "requires": [
                (
                    paths.local_extraction_layout(study_id, "acrf", output_dir)
                    / "rendered"
                    / "source.md",
                    "file",
                ),
            ],
            "produces": [(sections_toc_dir, "dir_nonempty")],
        },
        {
            "id": "steps_1_5",
            "title": "V2 Generation: Steps 1-5",
            "requires": [
                (sections_toc_dir, "dir_nonempty"),
                (
                    paths.local_extraction_opendataloader(study_id, "protocol", output_dir)
                    / "rendered"
                    / "source.md",
                    "file",
                ),
            ],
            "produces": [
                (paths.local_acrf_summary_text_merged(study_id, output_dir), "file"),
                (paths.local_protocol_paragraph_index_json(study_id, output_dir), "file"),
                (paths.local_rules_parsed_json(study_id, output_dir), "file"),
                (paths.local_deviations_review_state(study_id, output_dir), "file"),
            ],
        },
        {
            "id": "step_8",
            "title": "Pseudo Generation: Step 8",
            "requires": [
                (paths.local_deviations_validated_json(study_id, output_dir), "file"),
                (paths.local_rules_parsed_json(study_id, output_dir), "file"),
                (paths.local_acrf_summary_text_merged(study_id, output_dir), "file"),
            ],
            "produces": [(paths.local_pseudo_logic_review_state(study_id, output_dir), "file")],
        },
        {
            "id": "step_10",
            "title": "Finalize: Step 10",
            "requires": [
                (paths.local_deviations_validated_json(study_id, output_dir), "file"),
                (paths.local_pseudo_logic_validated_json(study_id, output_dir), "file"),
                (paths.local_rules_parsed_json(study_id, output_dir), "file"),
            ],
            "produces": [
                (paths.local_final_deviations_json(study_id, output_dir), "file"),
                (paths.local_final_deviations_xlsx(study_id, output_dir), "file"),
            ],
        },
    ]


def _contract_status(contract: Dict[str, Any]) -> tuple[str, List[str]]:
    missing_requires = [
        str(path)
        for path, kind in contract["requires"]
        if not _artifact_exists(path, kind)
    ]
    if missing_requires:
        return "blocked", missing_requires
    produced_all = all(
        _artifact_exists(path, kind) for path, kind in contract["produces"]
    )
    if produced_all:
        return "complete", []
    return "ready", []


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


def _escape_attr(value: str) -> str:
    return (
        value.replace("&", "&amp;")
        .replace('"', "&quot;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def _render_readonly_cell(value: str, tooltip: str) -> None:
    safe_value = _escape_attr(value)
    safe_tooltip = _escape_attr(tooltip)
    st.markdown(
        f'<div class="readonly-cell" title="{safe_tooltip}">{safe_value}</div>',
        unsafe_allow_html=True,
    )


def _load_state(study_id: str, output_dir: Path) -> Dict[str, Any]:
    path = paths.local_deviations_review_state(study_id, output_dir)
    if not path.is_file():
        raise FileNotFoundError(f"Missing review state: {path}")
    return read_json(path)


def _persist_state(
    study_id: str,
    output_dir: Path,
    state_obj: Dict[str, Any],
    audit_obj: Dict[str, Any],
) -> None:
    write_json(paths.local_deviations_review_state(study_id, output_dir), state_obj)
    write_json(paths.local_deviations_validated_json(study_id, output_dir), state_obj)
    write_json(paths.local_deviations_review_audit_json(study_id, output_dir), audit_obj)


def _chat_state_path(study_id: str, output_dir: Path) -> Path:
    return paths.local_review_dir(study_id, output_dir) / "deviation_chat_state.json"


def _load_chat_state(study_id: str, output_dir: Path) -> Dict[str, Any]:
    path = _chat_state_path(study_id, output_dir)
    if path.is_file():
        return read_json(path)
    return {
        "schema_version": "1.0.0",
        "study_id": study_id,
        "updated_at": "",
        "deviations": {},
    }


def _save_chat_state(study_id: str, output_dir: Path, chat_obj: Dict[str, Any]) -> None:
    chat_obj["updated_at"] = datetime.now(timezone.utc).isoformat()
    write_json(_chat_state_path(study_id, output_dir), chat_obj)


def _append_chat_message(
    chat_obj: Dict[str, Any],
    deviation_id: str,
    *,
    role: str,
    text: str,
) -> None:
    dev_key = str(deviation_id)
    by_dev = dict(chat_obj.get("deviations", {}))
    cur = dict(by_dev.get(dev_key, {"messages": []}))
    msgs = list(cur.get("messages", []))
    msgs.append(
        {
            "role": role,
            "text": text,
            "ts": datetime.now(timezone.utc).isoformat(),
        }
    )
    cur["messages"] = msgs[-25:]
    by_dev[dev_key] = cur
    chat_obj["deviations"] = by_dev


def _replace_row(state_obj: Dict[str, Any], updated_row: Dict[str, Any]) -> Dict[str, Any]:
    dev_id = str(updated_row.get("deviation_id", ""))
    rows = list(state_obj.get("deviations", []))
    for i, row in enumerate(rows):
        if str(row.get("deviation_id", "")) == dev_id:
            rows[i] = updated_row
            break
    state_obj["deviations"] = rows
    return state_obj


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
    write_json(
        paths.local_pseudo_logic_review_audit_json(study_id, output_dir),
        {
            "study_id": study_id,
            "review_type": "pseudo_logic",
            "updated_rows": len(pseudo_obj.get("items", [])),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
    )


def _upsert_pseudo_item(pseudo_obj: Dict[str, Any], item: Dict[str, Any]) -> None:
    items = list(pseudo_obj.get("items", []))
    by_id = {str(it.get("deviation_id", "")): it for it in items}
    dev_id = str(item.get("deviation_id", ""))
    if dev_id in by_id:
        cur = by_id[dev_id]
        cur["rule_id"] = item.get("rule_id", cur.get("rule_id", ""))
        cur["rule_title"] = item.get("rule_title", cur.get("rule_title", ""))
        cur["pseudo_logic"] = item.get("pseudo_logic", cur.get("pseudo_logic", ""))
        cur["programmable"] = item.get("programmable", cur.get("programmable", False))
        cur["programmability_note"] = item.get(
            "programmability_note", cur.get("programmability_note", "")
        )
    else:
        items.append(item)
    pseudo_obj["items"] = items


def _review_completion_counts(rows: List[Dict[str, Any]]) -> Dict[str, int]:
    counts = {"pending": 0, "accepted": 0, "to_review": 0, "rejected": 0}
    for row in rows:
        status = str(row.get("status", "pending"))
        if status not in counts:
            status = "pending"
        counts[status] += 1
    return counts


def _render_stage_card(
    *,
    title: str,
    status: str,
    missing: List[str],
    action_label: str,
    action_key: str,
    stage_id: str,
    run_action: Callable[[], tuple[bool, str, str]],
) -> None:
    with st.container(border=True):
        st.markdown(f"**{title}**")
        st.caption(f"status: `{_status_badge(status)}`")
        if missing:
            st.caption("Missing prerequisites:")
            for item in missing:
                st.code(item, language="text")
        if st.button(
            action_label,
            key=action_key,
            disabled=(status == "blocked"),
            use_container_width=True,
        ):
            with st.spinner("Running..."):
                ok, stdout_text, stderr_text = run_action()
            st.session_state[_STAGE_FEEDBACK_KEY] = {
                "stage_id": stage_id,
                "title": title,
                "ok": ok,
                "stdout": stdout_text,
                "stderr": stderr_text,
            }
            st.rerun()


def _render_last_stage_feedback(*, stage_id: Optional[str] = None) -> None:
    fb = st.session_state.get(_STAGE_FEEDBACK_KEY)
    if not fb:
        return
    feedback_stage_id = str(fb.get("stage_id", ""))
    if stage_id and feedback_stage_id and feedback_stage_id != stage_id:
        return
    title = str(fb.get("title", "Stage"))
    if fb.get("ok"):
        st.success(f"{title} — completed.")
    else:
        st.error(f"{title} — failed.")
    out = str(fb.get("stdout") or "").strip()
    err = str(fb.get("stderr") or "").strip()
    if out:
        st.text_area("Logs", value=out, height=140, key="pdcheck_fb_stdout")
    if err:
        st.text_area("Errors", value=err, height=180, key="pdcheck_fb_stderr")


def _render_stage_artifacts(
    *,
    contract: Dict[str, Any],
) -> None:
    with st.container(border=True):
        st.markdown("**Artifacts**")
        st.caption("Requires")
        if not contract["requires"]:
            st.caption("None")
        for path, kind in contract["requires"]:
            exists = _artifact_exists(path, kind)
            st.code(f"[{'ok' if exists else 'missing'}] {path}", language="text")
        st.caption("Produces")
        for path, kind in contract["produces"]:
            exists = _artifact_exists(path, kind)
            st.code(f"[{'ok' if exists else 'missing'}] {path}", language="text")


def _render_paths_checklist(requires: List[Any], produces: List[Any]) -> None:
    """Show prerequisite/output paths for a wizard step (mirrors `_render_stage_artifacts`)."""
    fake = {"requires": [(p, k) for p, k in requires], "produces": [(p, k) for p, k in produces]}
    _render_stage_artifacts(contract=fake)


def _status_ui_label(internal: str) -> str:
    return {
        "accepted": "Accepted",
        "rejected": "Declined",
        "pending": "Pending",
        "to_review": "Needs review",
    }.get(internal, internal)


def _render_wizard_left_rail(step_states: List[Dict[str, Any]]) -> str:
    st.sidebar.markdown("### All steps")
    for s in step_states:
        css = {
            "complete": "wiz-line-complete",
            "ready": "wiz-line-ready",
            "blocked": "wiz-line-blocked",
        }.get(str(s["status"]), "wiz-line-blocked")
        lock = "" if s["selectable"] else " (locked)"
        st.sidebar.markdown(
            f'<p class="{css}">{s["number"]}. <strong>{s["title"]}</strong> — '
            f'<code>{s["status"]}</code>{lock}</p>',
            unsafe_allow_html=True,
        )

    selectable = [str(s["id"]) for s in step_states if s["selectable"]]
    default_id = selectable[0] if selectable else str(step_states[0]["id"])
    cur = st.session_state.get(_WIZ_SELECTED_STEP, default_id)
    if cur not in selectable and selectable:
        cur = selectable[0]
    if not selectable:
        cur = str(step_states[0]["id"])
    st.session_state[_WIZ_SELECTED_STEP] = cur

    label_by_id = {str(s["id"]): f'{s["number"]}. {s["title"]} ({s["status"]})' for s in step_states}
    options = selectable if selectable else [str(s["id"]) for s in step_states]
    chosen = st.sidebar.radio(
        "Workbench step",
        options,
        index=options.index(cur) if cur in options else 0,
        format_func=lambda x: label_by_id.get(x, x),
    )
    st.session_state[_WIZ_SELECTED_STEP] = chosen
    return chosen


def _render_context_panel(
    *,
    study_id: str,
    output_dir: Path,
    mode_config: UiModeConfig,
) -> None:
    with st.container(border=True):
        st.markdown("**Context**")
        st.caption(f"study_id: `{study_id}`")
        st.caption(f"output_dir: `{output_dir}`")
        st.caption(f"data mode: `{mode_config.mode}`")
        if mode_config.mode != "real":
            st.caption(f"fixtures: `{mode_config.fixtures_dir}`")
        last = st.session_state.get(_STAGE_FEEDBACK_KEY)
        if last:
            status = "completed" if last.get("ok") else "failed"
            st.caption(f"last run: `{last.get('title', '')}` ({status})")


def _render_workshop_panel(
    *,
    study_id: str,
    output_dir: Path,
    mode_config: UiModeConfig,
    step_state: Dict[str, Any],
) -> None:
    st.subheader(step_state["title"])
    if not step_state["selectable"]:
        st.warning("Complete prior steps to unlock this workshop.")
        return
    if str(step_state["status"]) == "blocked":
        st.error("Missing prerequisites:")
        for m in step_state["missing"]:
            st.code(m, language="text")
        return

    rules = _rules_by_id(study_id, output_dir)
    paragraphs = _paragraphs_by_id(study_id, output_dir)
    state_obj = _load_state(study_id, output_dir)
    chat_obj = _load_chat_state(study_id, output_dir)
    pseudo_obj = _load_pseudo_state(study_id, output_dir)

    rows = list(state_obj.get("deviations", []))
    counts = _review_completion_counts(rows)
    st.caption(
        f"Rows: {len(rows)} — Accepted={counts['accepted']} Declined={counts['rejected']} "
        f"Pending={counts['pending']} Needs review={counts['to_review']}"
    )

    run_revision_cycle = st.checkbox("LLM refine on Send", value=True)
    auto_pseudo = st.checkbox("Auto-update pseudo logic after Send", value=True)

    up = st.file_uploader("Import deviations CSV", type=["csv"], key="wiz_csv_up")
    if up is not None:
        raw = up.getvalue()
        existing = {str(r.get("deviation_id", "")) for r in rows}
        new_rows, errs = wiz.parse_import_csv(raw, existing)
        if errs:
            st.error("CSV issues:\n" + "\n".join(errs[:20]))
        if new_rows:
            rows.extend(new_rows)
            state_obj["deviations"] = rows
            _persist_state(
                study_id,
                output_dir,
                state_obj,
                {
                    "study_id": study_id,
                    "review_type": "deviations",
                    "deviation_id": "",
                    "updated_rows": len(new_rows),
                    "revised_rows": 0,
                    "run_revision_cycle": False,
                },
            )
            st.success(f"Imported {len(new_rows)} deviation(s).")
            st.rerun()

    with st.expander("Add one deviation manually"):
        col_a, col_b = st.columns(2)
        with col_a:
            mid = st.text_input("deviation_id", key="wiz_man_id")
            mrule = st.text_input("rule_id", key="wiz_man_rule")
        with col_b:
            mrefs = st.text_input("paragraph_refs (comma-separated, e.g. p1,p2)", key="wiz_man_refs")
            mtext = st.text_area("text", key="wiz_man_text", height=80)
        if st.button("Add deviation", key="wiz_man_add"):
            parts = [p.strip() for p in mrefs.split(",") if p.strip()]
            if not mid.strip() or not mrule.strip() or not mtext.strip() or not parts:
                st.error("All fields are required.")
            elif mid.strip() in {str(r.get("deviation_id", "")) for r in rows}:
                st.error("deviation_id already exists.")
            elif any(not re.match(r"^p[0-9]+$", p) for p in parts):
                st.error("Invalid paragraph ref (use p1, p2, ...).")
            else:
                rows.append(
                    {
                        "deviation_id": mid.strip(),
                        "rule_id": mrule.strip(),
                        "text": mtext.strip(),
                        "paragraph_refs": parts,
                        "data_support_note": "",
                        "status": "pending",
                        "dm_comment": "",
                        "entry_source": "imported",
                    }
                )
                state_obj["deviations"] = rows
                _persist_state(
                    study_id,
                    output_dir,
                    state_obj,
                    {
                        "study_id": study_id,
                        "review_type": "deviations",
                        "deviation_id": mid.strip(),
                        "updated_rows": 1,
                        "revised_rows": 0,
                        "run_revision_cycle": False,
                    },
                )
                st.rerun()

    if st.button("Generate pseudo logic for all rows", key="wiz_pseudo_all"):
        n = 0
        for row in rows:
            item = ui_test_mode.generate_pseudo_logic_for_deviation(
                study_id=study_id,
                output_dir=output_dir,
                deviation=row,
                config=mode_config,
                rule_by_id=rules,
            )
            _upsert_pseudo_item(pseudo_obj, item)
            n += 1
        _save_pseudo_state(study_id, output_dir, pseudo_obj)
        st.success(f"Generated pseudo for {n} row(s).")
        st.rerun()

    pseudo_by_dev = {str(it.get("deviation_id", "")): it for it in pseudo_obj.get("items", [])}
    grid_rows: List[Dict[str, Any]] = []
    for row in rows:
        dev_id = str(row.get("deviation_id", ""))
        pi = pseudo_by_dev.get(dev_id, {})
        st_lbl = _status_ui_label(str(row.get("status", "pending")))
        src = str(row.get("entry_source", "extracted"))
        txt = str(row.get("text", ""))
        grid_rows.append(
            {
                "deviation_id": dev_id,
                "rule_id": row.get("rule_id", ""),
                "status": st_lbl,
                "text_preview": txt[:160] + ("…" if len(txt) > 160 else ""),
                "paragraph_refs": ", ".join(row.get("paragraph_refs", [])),
                "pseudo_preview": str(pi.get("pseudo_logic", ""))[:120],
                "source": src,
            }
        )
    st.dataframe(
        grid_rows,
        use_container_width=True,
        height=min(420, 60 + 28 * max(len(grid_rows), 1)),
    )

    dev_ids = [str(r.get("deviation_id", "")) for r in rows if str(r.get("deviation_id", ""))]
    if not dev_ids:
        st.info("No deviations to review.")
        return

    pick = st.selectbox("Selected deviation", dev_ids, key="wiz_pick_dev")
    row = next(r for r in rows if str(r.get("deviation_id", "")) == pick)
    rule = rules.get(str(row.get("rule_id", "")), {})

    st.markdown("**Protocol / rule context**")
    _render_readonly_cell(str(row.get("text", "")), _rule_tooltip(rule))
    refs = list(row.get("paragraph_refs", []))
    _render_readonly_cell(", ".join(refs) if refs else "(none)", _paragraph_tooltip(refs, paragraphs))

    st.markdown("**Chat**")
    dev_chat = chat_obj.get("deviations", {}).get(pick, {})
    for msg in dev_chat.get("messages", [])[-25:]:
        st.text(f"{msg.get('role', 'note')}: {msg.get('text', '')}")

    dm_comment = st.text_area("Message", key=f"wiz_chat_{pick}", height=72, placeholder="DM note / instruction")
    c1, c2, c3 = st.columns(3)
    with c1:
        if st.button("Send (refine)", key=f"wiz_send_{pick}"):
            _append_chat_message(chat_obj, pick, role="dm", text=dm_comment.strip() or "(empty)")
            try:
                revised_row, audit = ui_test_mode.refine_single_deviation_with_comment(
                    study_id=study_id,
                    output_dir=output_dir,
                    row=row,
                    dm_comment=dm_comment,
                    run_revision_cycle=run_revision_cycle,
                    config=mode_config,
                )
                _append_chat_message(
                    chat_obj, pick, role="assistant", text="Updated deviation from your message."
                )
                state_obj = _replace_row(state_obj, revised_row)
                _persist_state(study_id, output_dir, state_obj, audit)
                if auto_pseudo:
                    item = ui_test_mode.generate_pseudo_logic_for_deviation(
                        study_id=study_id,
                        output_dir=output_dir,
                        deviation=revised_row,
                        config=mode_config,
                        rule_by_id=rules,
                    )
                    _upsert_pseudo_item(pseudo_obj, item)
                    _save_pseudo_state(study_id, output_dir, pseudo_obj)
                _save_chat_state(study_id, output_dir, chat_obj)
                st.rerun()
            except Exception as ex:
                _append_chat_message(chat_obj, pick, role="assistant", text=f"Refinement failed: {ex}")
                _save_chat_state(study_id, output_dir, chat_obj)
                st.error(str(ex))
    with c2:
        if st.button("Accept", key=f"wiz_acc_{pick}"):
            row["status"] = "accepted"
            _append_chat_message(chat_obj, pick, role="dm", text="Decision: Accepted")
            state_obj = _replace_row(state_obj, row)
            _persist_state(
                study_id,
                output_dir,
                state_obj,
                {
                    "study_id": study_id,
                    "review_type": "deviations",
                    "deviation_id": pick,
                    "updated_rows": 1,
                    "revised_rows": 0,
                    "run_revision_cycle": False,
                },
            )
            if auto_pseudo:
                item = ui_test_mode.generate_pseudo_logic_for_deviation(
                    study_id=study_id,
                    output_dir=output_dir,
                    deviation=row,
                    config=mode_config,
                    rule_by_id=rules,
                )
                _upsert_pseudo_item(pseudo_obj, item)
                _save_pseudo_state(study_id, output_dir, pseudo_obj)
            _save_chat_state(study_id, output_dir, chat_obj)
            st.rerun()
    with c3:
        if st.button("Decline", key=f"wiz_decl_{pick}"):
            row["status"] = "rejected"
            _append_chat_message(chat_obj, pick, role="dm", text="Decision: Declined")
            state_obj = _replace_row(state_obj, row)
            _persist_state(
                study_id,
                output_dir,
                state_obj,
                {
                    "study_id": study_id,
                    "review_type": "deviations",
                    "deviation_id": pick,
                    "updated_rows": 1,
                    "revised_rows": 0,
                    "run_revision_cycle": False,
                },
            )
            _save_chat_state(study_id, output_dir, chat_obj)
            st.rerun()

    if wiz.deviations_all_terminal(study_id, output_dir):
        st.success(
            "All deviations are Accepted or Declined. Continue with **Pseudo batch** "
            "and **Finalize**, or revise rows above."
        )
    else:
        st.info("Set each deviation to **Accepted** or **Declined** (or refine via chat) before moving on.")


def _render_wizard_automated_panel(
    *,
    step_id: str,
    step_title: str,
    study_id: str,
    output_dir: Path,
    mode_config: UiModeConfig,
    step_state: Dict[str, Any],
    requires: List[Tuple[Path, str]],
    produces: List[Tuple[Path, str]],
) -> None:
    st.subheader(step_title)
    if not step_state["selectable"]:
        st.warning("Complete prior steps to unlock this action.")
    if step_state["missing"]:
        st.caption("Missing prerequisites:")
        for m in step_state["missing"]:
            st.code(m, language="text")

    can_run = bool(step_state["selectable"]) and str(step_state["status"]) != "blocked"
    sas = int(os.getenv("DI_SAS_TTL_MINUTES", "15"))

    run_action = None
    lbl = ""
    if step_id == "extract_protocol":
        lbl = "Run protocol extraction (OpenDataLoader + DI)"
        run_action = lambda: _capture_run(
            lambda: ui_test_mode.run_extract_for_ui(
                study_id=study_id,
                output_dir=output_dir,
                config=mode_config,
                protocol_blob=None,
                acrf_blob=None,
                model_id=None,
                sas_ttl=sas,
                upload=True,
                skip_acrf=True,
                skip_protocol=False,
                upload_only=False,
                run_opendataloader_ocr=True,
                opendataloader_only=False,
                debug_blob=False,
            )
        )
    elif step_id == "extract_acrf":
        lbl = "Run aCRF extraction"
        run_action = lambda: _capture_run(
            lambda: ui_test_mode.run_extract_for_ui(
                study_id=study_id,
                output_dir=output_dir,
                config=mode_config,
                protocol_blob=None,
                acrf_blob=None,
                model_id=None,
                sas_ttl=sas,
                upload=True,
                skip_acrf=False,
                skip_protocol=True,
                upload_only=False,
                run_opendataloader_ocr=True,
                opendataloader_only=False,
                debug_blob=False,
            )
        )
    elif step_id == "split_toc":
        lbl = "Run aCRF split-toc"
        run_action = lambda: _capture_run(
            lambda: ui_test_mode.run_split_toc_for_ui(
                study_id=study_id,
                output_dir=output_dir,
                config=mode_config,
                write_manifest=True,
            )
        )
    elif step_id == "v2_step_1":
        lbl = "Run V2 step 1 (aCRF summary)"
        run_action = lambda: _capture_run(
            lambda: ui_test_mode.run_steps(
                study_id=study_id,
                output_dir=output_dir,
                from_step=1,
                to_step=1,
                config=mode_config,
            )
        )
    elif step_id == "v2_step_2":
        lbl = "Run V2 step 2 (paragraph index)"
        run_action = lambda: _capture_run(
            lambda: ui_test_mode.run_steps(
                study_id=study_id,
                output_dir=output_dir,
                from_step=2,
                to_step=2,
                config=mode_config,
            )
        )
    elif step_id == "v2_step_3":
        lbl = "Run V2 step 3 (rules)"
        run_action = lambda: _capture_run(
            lambda: ui_test_mode.run_steps(
                study_id=study_id,
                output_dir=output_dir,
                from_step=3,
                to_step=3,
                config=mode_config,
            )
        )
    elif step_id == "v2_step_4_5":
        lbl = "Run V2 steps 4–5 (deviations + review init)"
        run_action = lambda: _capture_run(
            lambda: ui_test_mode.run_steps(
                study_id=study_id,
                output_dir=output_dir,
                from_step=4,
                to_step=4,
                config=mode_config,
            )
        )
    elif step_id == "step_8":
        lbl = "Run V2 step 8 (pseudo batch for accepted deviations)"
        run_action = lambda: _capture_run(
            lambda: ui_test_mode.run_steps(
                study_id=study_id,
                output_dir=output_dir,
                from_step=8,
                to_step=8,
                config=mode_config,
            )
        )
    elif step_id == "step_10":
        lbl = "Run V2 step 10 (finalize JSON + XLSX)"
        run_action = lambda: _capture_run(
            lambda: ui_test_mode.step10_finalize(
                study_id=study_id,
                output_dir=output_dir,
                config=mode_config,
            )
        )

    if run_action and lbl:
        if st.button(lbl, key=f"wiz_run_{step_id}", disabled=not can_run, use_container_width=True):
            with st.spinner("Running..."):
                ok, stdout_text, stderr_text = run_action()
            st.session_state[_STAGE_FEEDBACK_KEY] = {
                "stage_id": step_id,
                "title": step_title,
                "ok": ok,
                "stdout": stdout_text,
                "stderr": stderr_text,
            }
            st.rerun()

    _render_last_stage_feedback(stage_id=step_id)
    _render_paths_checklist(requires, produces)


def _render_wizard_outputs_panel(
    *,
    study_id: str,
    output_dir: Path,
    step_state: Dict[str, Any],
    requires: List[Tuple[Path, str]],
    produces: List[Tuple[Path, str]],
) -> None:
    st.subheader("Final outputs")
    if not step_state["selectable"]:
        st.warning("Complete finalize first.")
    _render_paths_checklist(requires, produces)
    fj = paths.local_final_deviations_json(study_id, output_dir)
    fx = paths.local_final_deviations_xlsx(study_id, output_dir)
    if fj.is_file():
        st.download_button("Download JSON", data=fj.read_bytes(), file_name=fj.name, key="dl_json")
    if fx.is_file():
        st.download_button("Download XLSX", data=fx.read_bytes(), file_name=fx.name, key="dl_xlsx")


def _render_wizard_workbench(
    *,
    selected_id: str,
    study_id: str,
    output_dir: Path,
    mode_config: UiModeConfig,
    step_states: List[Dict[str, Any]],
    steps: List[wiz.WizardStep],
) -> None:
    by_id = {str(s["id"]): s for s in step_states}
    meta = {s.id: s for s in steps}
    if selected_id not in meta:
        st.error("Unknown step.")
        return
    wz = meta[selected_id]
    st_data = by_id[selected_id]
    if wz.kind == "ui_workshop":
        _render_workshop_panel(
            study_id=study_id,
            output_dir=output_dir,
            mode_config=mode_config,
            step_state=st_data,
        )
    elif wz.kind == "outputs":
        _render_wizard_outputs_panel(
            study_id=study_id,
            output_dir=output_dir,
            step_state=st_data,
            requires=list(wz.requires),
            produces=list(wz.produces),
        )
    else:
        _render_wizard_automated_panel(
            step_id=wz.id,
            step_title=wz.title,
            study_id=study_id,
            output_dir=output_dir,
            mode_config=mode_config,
            step_state=st_data,
            requires=list(wz.requires),
            produces=list(wz.produces),
        )


def render_app(
    *,
    study_id: str,
    output_dir: Path,
    data_mode: Literal["real", "test", "mixed"],
    fixtures_dir: Path,
) -> None:
    st.set_page_config(page_title="PD Check V2 Review", layout="wide")
    _inject_compact_styles()
    mode_config = _ui_mode_config(data_mode=data_mode, fixtures_dir=fixtures_dir)
    st.title(f"Study {study_id} — V2 Step-by-step")
    st.caption(f"Left rail: full pipeline. Data mode: `{mode_config.mode}`.")

    steps = wiz.wizard_steps(study_id, output_dir)
    workshop_done = wiz.deviations_all_terminal(study_id, output_dir)
    step_states = wiz.compute_step_states(steps, workshop_done)
    selected_id = _render_wizard_left_rail(step_states)

    contracts = _step_contracts(study_id, output_dir)
    status_by_id: Dict[str, str] = {}
    for c in contracts:
        st_c, _ = _contract_status(c)
        status_by_id[c["id"]] = st_c

    with st.expander("Preflight checks", expanded=True):
        missing_env = _required_env_missing(
            [
                "STORAGE_CONNECTION_STRING",
                "STORAGE_CONTAINER",
                "DI_ENDPOINT",
                "DI_KEY",
                "AZURE_OPENAI_ENDPOINT",
                "AZURE_OPENAI_API_KEY",
                "AZURE_OPENAI_DEPLOYMENT",
            ]
        )
        if missing_env:
            st.error("Missing required environment variables for full pipeline:")
            st.code("\n".join(missing_env), language="text")
        else:
            st.success("Required environment variables detected.")
        if mode_config.mode == "test":
            st.info(f"Synthetic mode enabled. Fixtures: {mode_config.fixtures_dir}")
        elif mode_config.mode == "mixed":
            st.info(
                f"Mixed mode enabled (real with synthetic fallback). Fixtures: "
                f"{mode_config.fixtures_dir}"
            )
        else:
            st.caption("Real mode enabled (LLM-backed pipeline calls).")
        for contract in contracts:
            st.caption(
                f"{contract['title']}: status `{_status_badge(status_by_id[contract['id']])}`"
            )

    main_col, context_col = st.columns([3.4, 1.2])
    with main_col:
        _render_wizard_workbench(
            selected_id=selected_id,
            study_id=study_id,
            output_dir=output_dir,
            mode_config=mode_config,
            step_states=step_states,
            steps=steps,
        )
    with context_col:
        _render_context_panel(
            study_id=study_id,
            output_dir=output_dir,
            mode_config=mode_config,
        )


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Streamlit V2 review app.")
    parser.add_argument("--study-id", required=True)
    parser.add_argument("--output-dir", default="output")
    parser.add_argument("--data-mode", choices=["real", "test", "mixed"], default="real")
    parser.add_argument("--fixtures-dir", default="tests/fixtures/ui_v2")
    return parser.parse_args()


def main() -> None:
    args = _parse_args()
    render_app(
        study_id=args.study_id,
        output_dir=Path(args.output_dir),
        data_mode=args.data_mode,
        fixtures_dir=Path(args.fixtures_dir),
    )


if __name__ == "__main__":
    main()

"""Streamlit UI for full Pipeline V2 workflow and review loops."""

from __future__ import annotations

import argparse
import io
import os
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Literal

import streamlit as st

from pdcheck_factory import paths
from pdcheck_factory.json_util import read_json, write_json
from pdcheck_factory.ui_test_mode import UiModeConfig
from pdcheck_factory import ui_test_mode

_STAGE_FEEDBACK_KEY = "_pdcheck_last_stage"


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
                "title": title,
                "ok": ok,
                "stdout": stdout_text,
                "stderr": stderr_text,
            }
            st.rerun()


def _render_last_stage_feedback() -> None:
    fb = st.session_state.pop(_STAGE_FEEDBACK_KEY, None)
    if not fb:
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


def _render_deviation_review_panel(
    *,
    study_id: str,
    output_dir: Path,
    rules: Dict[str, Dict[str, Any]],
    paragraphs: Dict[str, str],
    state_obj: Dict[str, Any],
    chat_obj: Dict[str, Any],
    pseudo_obj: Dict[str, Any],
    mode_config: UiModeConfig,
) -> None:
    rows = list(state_obj.get("deviations", []))
    counts = _review_completion_counts(rows)
    st.caption(
        f"completion: accepted={counts['accepted']} pending={counts['pending']} "
        f"to_review={counts['to_review']} rejected={counts['rejected']}"
    )
    run_revision_cycle = st.checkbox("LLM refine on Send", value=True)
    if st.button("Generate Logic for All deviations", use_container_width=False):
        generated = 0
        for row in rows:
            item = ui_test_mode.generate_pseudo_logic_for_deviation(
                study_id=study_id,
                output_dir=output_dir,
                deviation=row,
                config=mode_config,
                rule_by_id=rules,
            )
            _upsert_pseudo_item(pseudo_obj, item)
            generated += 1
        _save_pseudo_state(study_id, output_dir, pseudo_obj)
        st.success(f"Generated pseudo logic for {generated} deviations.")
        st.rerun()

    pseudo_by_dev = {
        str(it.get("deviation_id", "")): it for it in pseudo_obj.get("items", [])
    }
    h1, h2, h3, h4, h5, h6, h7 = st.columns([0.9, 1.0, 3.0, 1.0, 1.4, 1.3, 1.0])
    h1.markdown('<div class="compact-head">Deviation</div>', unsafe_allow_html=True)
    h2.markdown('<div class="compact-head">Rule</div>', unsafe_allow_html=True)
    h3.markdown('<div class="compact-head">Deviation text</div>', unsafe_allow_html=True)
    h4.markdown('<div class="compact-head">Refs</div>', unsafe_allow_html=True)
    h5.markdown('<div class="compact-head">Status</div>', unsafe_allow_html=True)
    h6.markdown('<div class="compact-head">Pseudo</div>', unsafe_allow_html=True)
    h7.markdown('<div class="compact-head">Refine</div>', unsafe_allow_html=True)

    for row in rows:
        dev_id = str(row.get("deviation_id", ""))
        rule = rules.get(str(row.get("rule_id", "")), {})
        refs = list(row.get("paragraph_refs", []))
        pseudo_item = pseudo_by_dev.get(dev_id, {})
        st.markdown('<div class="row-sep"></div>', unsafe_allow_html=True)
        c_dev, c_rule, c_text, c_refs, c_status, c_pseudo, c_refine = st.columns(
            [0.9, 1.0, 3.0, 1.0, 1.4, 1.3, 1.0]
        )
        with c_dev:
            st.markdown(f"**{dev_id}**")
        with c_rule:
            st.markdown(f"`{row.get('rule_id', '')}`")
            st.caption((rule.get("title", "") or "(untitled)")[:72])
        with c_text:
            _render_readonly_cell(str(row.get("text", "")), _rule_tooltip(rule))
        with c_refs:
            refs_text = ", ".join(refs) if refs else "(none)"
            _render_readonly_cell(refs_text, _paragraph_tooltip(refs, paragraphs))
        with c_status:
            current = str(row.get("status", "pending"))
            if current not in {"pending", "accepted", "to_review", "rejected"}:
                current = "pending"
            status = st.selectbox(
                "Status",
                ["pending", "accepted", "to_review", "rejected"],
                index=["pending", "accepted", "to_review", "rejected"].index(current),
                key=f"status_{dev_id}",
                help=_rule_tooltip(rule),
                label_visibility="collapsed",
            )
            if status != current:
                row["status"] = status
                updated_state = _replace_row(state_obj, row)
                _persist_state(
                    study_id,
                    output_dir,
                    updated_state,
                    {
                        "study_id": study_id,
                        "review_type": "deviations",
                        "deviation_id": dev_id,
                        "updated_rows": 1,
                        "revised_rows": 0,
                        "run_revision_cycle": False,
                    },
                )
                st.rerun()
        with c_pseudo:
            pseudo_preview = (
                str(pseudo_item.get("pseudo_logic", ""))[:160] if pseudo_item else "(none)"
            )
            _render_readonly_cell(
                pseudo_preview,
                str(pseudo_item.get("pseudo_logic", "(no pseudo logic generated)")),
            )
        with c_refine:
            with st.popover("Refine", use_container_width=True):
                dev_chat = chat_obj.get("deviations", {}).get(dev_id, {})
                for msg in dev_chat.get("messages", [])[-6:]:
                    st.text(f"{msg.get('role', 'note')}: {msg.get('text', '')}")
                dm_comment = st.text_area(
                    "Comment",
                    key=f"comment_{dev_id}",
                    value="",
                    label_visibility="collapsed",
                    placeholder="Type comment and click Send...",
                    height=80,
                    help="Sends one targeted LLM refinement for this deviation.",
                )
                if st.button("Send", key=f"send_{dev_id}", use_container_width=True):
                    _append_chat_message(
                        chat_obj, dev_id, role="dm", text=dm_comment.strip() or "(empty)"
                    )
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
                            chat_obj,
                            dev_id,
                            role="assistant",
                            text="Updated deviation text and refs from latest DM comment.",
                        )
                        state_obj = _replace_row(state_obj, revised_row)
                        _persist_state(study_id, output_dir, state_obj, audit)
                        _save_chat_state(study_id, output_dir, chat_obj)
                        st.rerun()
                    except Exception as ex:
                        _append_chat_message(
                            chat_obj, dev_id, role="assistant", text=f"Refinement failed: {ex}"
                        )
                        _save_chat_state(study_id, output_dir, chat_obj)
                        st.error(f"Refinement failed for {dev_id}: {ex}")


def _render_pseudo_review_panel(
    *, study_id: str, output_dir: Path, pseudo_obj: Dict[str, Any]
) -> None:
    items = list(pseudo_obj.get("items", []))
    counts = _review_completion_counts(items)
    st.caption(
        f"completion: accepted={counts['accepted']} pending={counts['pending']} "
        f"to_review={counts['to_review']} rejected={counts['rejected']}"
    )
    h1, h2, h3, h4, h5 = st.columns([1.0, 1.0, 3.8, 1.2, 1.6])
    h1.markdown('<div class="compact-head">Deviation</div>', unsafe_allow_html=True)
    h2.markdown('<div class="compact-head">Rule</div>', unsafe_allow_html=True)
    h3.markdown('<div class="compact-head">Pseudo logic</div>', unsafe_allow_html=True)
    h4.markdown('<div class="compact-head">Programmable</div>', unsafe_allow_html=True)
    h5.markdown('<div class="compact-head">Status</div>', unsafe_allow_html=True)

    for item in items:
        dev_id = str(item.get("deviation_id", ""))
        st.markdown('<div class="row-sep"></div>', unsafe_allow_html=True)
        c1, c2, c3, c4, c5 = st.columns([1.0, 1.0, 3.8, 1.2, 1.6])
        with c1:
            st.markdown(f"**{dev_id}**")
        with c2:
            st.markdown(f"`{item.get('rule_id', '')}`")
        with c3:
            text = str(item.get("pseudo_logic", ""))
            _render_readonly_cell(text[:240], text)
        with c4:
            st.caption("yes" if bool(item.get("programmable")) else "no")
        with c5:
            current = str(item.get("status", "pending"))
            if current not in {"pending", "accepted", "to_review", "rejected"}:
                current = "pending"
            status = st.selectbox(
                "Pseudo status",
                ["pending", "accepted", "to_review", "rejected"],
                index=["pending", "accepted", "to_review", "rejected"].index(current),
                key=f"pseudo_status_{dev_id}",
                label_visibility="collapsed",
            )
            if status != current:
                item["status"] = status
                _save_pseudo_state(study_id, output_dir, pseudo_obj)
                st.rerun()


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
    st.title(f"Study {study_id} — V2 Workflow")
    st.caption(
        "End-to-end UI flow: prerequisites -> steps 1-10 -> final XLSX. "
        f"Data mode: {mode_config.mode}."
    )

    contracts = _step_contracts(study_id, output_dir)
    status_by_id: Dict[str, str] = {}
    missing_by_id: Dict[str, List[str]] = {}
    for contract in contracts:
        status, missing = _contract_status(contract)
        status_by_id[contract["id"]] = status
        missing_by_id[contract["id"]] = missing

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
            st.info(f"Mixed mode enabled (real with synthetic fallback). Fixtures: {mode_config.fixtures_dir}")
        else:
            st.caption("Real mode enabled (LLM-backed pipeline calls).")
        for contract in contracts:
            st.caption(
                f"{contract['title']}: status `{_status_badge(status_by_id[contract['id']])}`"
            )

    st.subheader("Run pipeline stages")
    _render_last_stage_feedback()
    c1, c2 = st.columns(2)
    with c1:
        _render_stage_card(
            title="Data Prep: Extract PDFs",
            status=status_by_id["extract"],
            missing=missing_by_id["extract"],
            action_label="Run extract",
            action_key="run_extract",
            run_action=lambda: _capture_run(
                lambda: ui_test_mode.run_extract_for_ui(
                    study_id=study_id,
                    output_dir=output_dir,
                    config=mode_config,
                    protocol_blob=None,
                    acrf_blob=None,
                    model_id=None,
                    sas_ttl=int(os.getenv("DI_SAS_TTL_MINUTES", "15")),
                    upload=True,
                    skip_acrf=False,
                    upload_only=False,
                    run_opendataloader_ocr=True,
                    opendataloader_only=False,
                    debug_blob=False,
                )
            ),
        )
    with c2:
        _render_stage_card(
            title="Data Prep: Split aCRF TOC",
            status=status_by_id["split_toc"],
            missing=missing_by_id["split_toc"],
            action_label="Run acrf split-toc",
            action_key="run_split_toc",
            run_action=lambda: _capture_run(
                lambda: ui_test_mode.run_split_toc_for_ui(
                    study_id=study_id,
                    output_dir=output_dir,
                    config=mode_config,
                    write_manifest=True,
                )
            ),
        )

    c3, c4 = st.columns(2)
    with c3:
        _render_stage_card(
            title="V2 Generation: Steps 1-5",
            status=status_by_id["steps_1_5"],
            missing=missing_by_id["steps_1_5"],
            action_label="Run v2 steps 1-5",
            action_key="run_1_5",
            run_action=lambda: _capture_run(
                lambda: ui_test_mode.run_steps(
                    study_id=study_id,
                    output_dir=output_dir,
                    from_step=1,
                    to_step=5,
                    config=mode_config,
                )
            ),
        )
    with c4:
        _render_stage_card(
            title="Pseudo Generation: Step 8",
            status=status_by_id["step_8"],
            missing=missing_by_id["step_8"],
            action_label="Run v2 step 8",
            action_key="run_8",
            run_action=lambda: _capture_run(
                lambda: ui_test_mode.run_steps(
                    study_id=study_id,
                    output_dir=output_dir,
                    from_step=8,
                    to_step=8,
                    config=mode_config,
                )
            ),
        )

    _render_stage_card(
        title="Finalize: Step 10",
        status=status_by_id["step_10"],
        missing=missing_by_id["step_10"],
        action_label="Run step 10 finalize",
        action_key="run_10",
        run_action=lambda: _capture_run(
            lambda: ui_test_mode.step10_finalize(
                study_id=study_id,
                output_dir=output_dir,
                config=mode_config,
            )
        ),
    )

    st.subheader("Deviation review (steps 6-7)")
    if paths.local_deviations_review_state(study_id, output_dir).is_file():
        rules = _rules_by_id(study_id, output_dir)
        paragraphs = _paragraphs_by_id(study_id, output_dir)
        state_obj = _load_state(study_id, output_dir)
        chat_obj = _load_chat_state(study_id, output_dir)
        pseudo_obj = _load_pseudo_state(study_id, output_dir)
        _render_deviation_review_panel(
            study_id=study_id,
            output_dir=output_dir,
            rules=rules,
            paragraphs=paragraphs,
            state_obj=state_obj,
            chat_obj=chat_obj,
            pseudo_obj=pseudo_obj,
            mode_config=mode_config,
        )
    else:
        st.info("Deviation review state is not available yet. Run steps 1-5 first.")

    st.subheader("Pseudo logic review (step 9)")
    if paths.local_pseudo_logic_review_state(study_id, output_dir).is_file():
        pseudo_obj = _load_pseudo_state(study_id, output_dir)
        _render_pseudo_review_panel(
            study_id=study_id, output_dir=output_dir, pseudo_obj=pseudo_obj
        )
    else:
        st.info("Pseudo review state is not available yet. Run step 8 first.")


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

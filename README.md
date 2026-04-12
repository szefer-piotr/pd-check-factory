# PD Check Factory

Single **Python** application to extract text and tables from clinical trial **protocol** and **annotated CRF (aCRF)** PDFs with **Azure AI Document Intelligence**, run two **Azure OpenAI** passes (protocol rules → draft protocol deviations grounded in the aCRF), validate JSON with existing schemas, export a **DM review Excel** workbook, and emit a **pseudo-logic bundle**.

There is no Azure Functions, Event Grid, or separate review UI in this MVP—only Blob storage, DI, and OpenAI.

## Prerequisites

- Python **3.11+**
- Azure Storage Account (one container is enough)
- Azure AI Document Intelligence resource
- Azure OpenAI deployment (chat model supporting JSON mode / `response_format`)

## Install

```bash
cd /path/to/pd-check-factory
python -m venv .venv
source .venv/bin/activate   # or .venv\Scripts\activate on Windows
pip install -U pip
pip install -e .           # or: pip install -r requirements.txt && pip install -e .
```

The console script **`pdcheck`** is provided by the editable install (see `[project.scripts]` in `pyproject.toml`). Alternatively:

```bash
python -m pdcheck_factory --help
```

## Configuration

Copy `.env.example` to `.env` and fill in endpoints and keys. The CLI loads `.env` via `python-dotenv`.

## Blob layout (prefixes in your container)

| Purpose | Path |
|--------|------|
| Raw PDF uploads | `raw/<study_id>/protocol.pdf`, `raw/<study_id>/acrf.pdf` |
| DI outputs | `extractions/<study_id>/protocol/layout/...`, `extractions/<study_id>/acrf/layout/...` |
| Rules KB (LLM 1) | `pipeline/<study_id>/protocol_rules_kb.json` |
| PD JSON | `pipeline/<study_id>/pd/candidates.json`, `logic_drafts.json`, `pd_draft_specs.json` |
| DM workbook | `review/<study_id>/dm_review_roundtrip.xlsx` |
| Pseudo bundle | `artifacts/<study_id>/pseudo_logic_bundle.json` |

Local cache mirrors the same structure under `output/<study_id>/`.

## Pipeline Commands

1. **Upload** `protocol.pdf` and `acrf.pdf` to the raw paths above (AzCopy, Portal, or SDK).

2. **Extract** (DI Layout, markdown + JSON):

   ```bash
   pdcheck extract --study-id MY-STUDY
   ```

   Optional: `--protocol-blob`, `--acrf-blob`, `--skip-acrf` (for protocol-only tests).

3. **Rules** (LLM pass 1 — protocol → `protocol_rules_kb.json`):

   ```bash
   pdcheck rules --study-id MY-STUDY
   ```

4. **Draft PD** (LLM pass 2 — rules + aCRF → candidates + logic):

   ```bash
   pdcheck draft-pd --study-id MY-STUDY
   ```

5. **Merge** (validate against `schemas/pd_draft_spec.schema.json`):

   ```bash
   pdcheck merge --study-id MY-STUDY
   ```

6. **DM Excel** — export, edit, apply:

   ```bash
   pdcheck export-review --study-id MY-STUDY
   pdcheck apply-review --study-id MY-STUDY --workbook ./path/to/edited.xlsx
   ```

   Workbook columns include `dm_decision` (`approve` / `reject` / `revise`), `dm_comments`, and optional `proposed_text` (updates `candidate_trigger_condition` when set).

7. **Pseudo bundle** (narrative steps + domains):

   ```bash
   pdcheck emit-pseudo --study-id MY-STUDY
   ```

**End-to-end** through merge (no XLSX):

```bash
pdcheck run-all --study-id MY-STUDY
```

Use `--no-upload` on any command to only write under `output/` without Blob uploads.

## JSON schemas

- `schemas/protocol_rules_kb.schema.json` — LLM pass 1 output
- `schemas/pd_candidate_output.schema.json`, `schemas/pd_logic_output.schema.json` — LLM pass 2
- `schemas/pd_draft_spec.schema.json` — merged workbook for review

## LLM prompts

System and user instructions for Azure OpenAI are Markdown files under [`pdcheck_factory/prompts/`](pdcheck_factory/prompts/). They are loaded at runtime via [`pdcheck_factory/prompt_loader.py`](pdcheck_factory/prompt_loader.py). Edit those files to change wording; input size limits (protocol/aCRF truncation) remain enforced in [`pdcheck_factory/llm.py`](pdcheck_factory/llm.py).

## License

See repository owner for license terms.

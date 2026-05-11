# PD Check Factory

Single **Python** application to extract text and tables from clinical trial **protocol** and **annotated CRF (aCRF)** PDFs with **Azure AI Document Intelligence**, segment the protocol Markdown into sections with **numbered sentences**, run **Step 1 Azure OpenAI extraction** (atomic protocol rules plus per-rule nested candidate deviations and short violation examples per section), run **Step 2 semantic merge/dedup**, support **DM Excel validation round-trip**, and optionally upload artifacts to Blob.

**Current scope:** Legacy Step 1/Step 2 flow plus **Pipeline V2** (paragraph-anchored full-protocol extraction, staged review loops, and final XLSX).

There is no Azure Functions, Event Grid, or separate review UI in this MVP—only Blob storage, DI, and OpenAI.

## Prerequisites

- Python **3.11+**
- Java Runtime (**required for OpenDataLoader OCR**, e.g. OpenJDK 17+)
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

The console script `**pdcheck**` is provided by the editable install (see `[project.scripts]` in `pyproject.toml`). Alternatively:

```bash
python -m pdcheck_factory --help
```

JSON schemas are loaded from the repo `schemas/` directory (project root). Prefer **editable installs** from a checkout so validation always finds those files.

## Configuration

Copy `.env.example` to `.env` and fill in endpoints and keys. The CLI loads `.env` via `python-dotenv`.

## Blob layout (prefixes in your container)


| Purpose                               | Path                                                                                                                                                                 |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Raw PDF uploads                       | `raw/<study_id>/protocol.pdf`, `raw/<study_id>/acrf.pdf`                                                                                                             |
| DI outputs                            | `extractions/<study_id>/protocol/layout/...`, `extractions/<study_id>/acrf/layout/...`                                                                               |
| OpenDataLoader OCR (comparison)       | `extractions/<study_id>/protocol/opendataloader/rendered/source.md`, `extractions/<study_id>/acrf/opendataloader/rendered/source.md`                                 |
| Protocol sections (Step 1)            | `pipeline/<study_id>/protocol_sections/sections_manifest.json`, `pipeline/<study_id>/protocol_sections/step1/<section_id>.json`                                      |
| aCRF section summaries                | `pipeline/<study_id>/acrf_summary/sections/<acrf_section_id>.json`, `pipeline/<study_id>/acrf_summary/acrf_summary_merged.json`                                      |
| Protocol sections (Step 2 merged)     | `pipeline/<study_id>/step2/step2_merged.json`                                                                                                                        |
| Step 2 DM workbook (export)           | `pipeline/<study_id>/step2/step2_dm_review.xlsx`                                                                                                                     |
| Step 2 DM outputs (apply)             | `pipeline/<study_id>/step2/step2_validated.json`, `pipeline/<study_id>/step2/step2_validation_audit.json`, `pipeline/<study_id>/step2/step2_dm_review.reviewed.xlsx` |
| DM workbook                           | `review/<study_id>/dm_review_roundtrip.xlsx`                                                                                                                         |


Local cache mirrors the same structure under `output/<study_id>/`.

## Pipeline Commands

### Pipeline V2 (recommended)

Pipeline V2 uses:
- protocol input from `output/<study_id>/extractions/protocol/opendataloader/rendered/source.md`
- paragraph-level references (`p1`, `p2`, ...)
- text-block prompts with strict separators
- review-state JSON loops for deviations and pseudo-logic

Run a step range:

```bash
pdcheck v2 run --study-id MY-STUDY --from-step 1 --to-step 2
pdcheck v2 run --study-id MY-STUDY --from-step 1 --to-step 5
pdcheck v2 run --study-id MY-STUDY --from-step 4 --to-step 10
```

Pipeline V2 steps:
1. aCRF plain-text summary (dataset/columns/value hints)
2. protocol paragraph indexing
3. whole-protocol rule extraction with coverage forcing
4. per-rule deviation extraction with aCRF support context
5. structured deviation artifact creation
6-7. deviation review/revision cycle in UI
8. pseudo-logic generation for accepted deviations
9. pseudo-logic review/revision cycle in UI
10. final JSON + XLSX production

Expected files used/written by Pipeline V2 review stages:
- Input: `output/<study_id>/pipeline/review/deviations_review_state.json`
- Input: `output/<study_id>/pipeline/rules/rules_parsed.json`
- Input: `output/<study_id>/pipeline/protocol_index/paragraph_index.json`
- Output: `output/<study_id>/pipeline/review/deviations_review_state.json`
- Output: `output/<study_id>/pipeline/review/deviations_validated.json`
- Output: `output/<study_id>/pipeline/review/deviations_review_audit.json`
- Output: `output/<study_id>/pipeline/review/deviation_chat_state.json`
- Output: `output/<study_id>/pipeline/review/pseudo_logic_review_state.json`
- Output: `output/<study_id>/pipeline/pseudo_logic/pseudo_logic_validated.json`
- Output: `output/<study_id>/pipeline/review/pseudo_logic_review_audit.json`
- Output: `output/<study_id>/pipeline/final/final_deviations.json`
- Output: `output/<study_id>/pipeline/final/final_deviations.xlsx`

1. **Upload** `protocol.pdf` and `acrf.pdf` to the raw paths above (AzCopy, Portal, or SDK).
2. **Extract** (DI Layout + OpenDataLoader OCR comparison markdown):
  ```bash
   pdcheck extract --study-id MY-STUDY
  ```
   Optional: `--protocol-blob`, `--acrf-blob`, `--skip-acrf` (for protocol-only tests), `--no-opendataloader-ocr` (disable extra OCR comparison output), `--opendataloader-only` (skip DI and run only OpenDataLoader OCR).
3. **Segment protocol** (headings → sections, sentences enumerated with stable IDs):
  ```bash
   pdcheck protocol segment --study-id MY-STUDY
  ```
   Writes `pipeline/<study_id>/protocol_sections/sections_manifest.json` and human-readable numbered fragments under `protocol_sections/raw/`.
   **DI page noise (default: strip):** By default, Azure DI HTML comments such as `PageHeader`, `PageFooter`, `PageNumber`, and `PageBreak` are removed from the markdown before parsing. Use `**--keep-di-page-markers`** to preserve them (e.g. for debugging).
   **Rollup:** `**--rollup-to-level N`** (1–6; **default 1**) keeps only `#` … `N`-hash headings as separate manifest sections; deeper headings are inlined into the parent section body as ATX lines (`### Child title`, …). Fewer sections ⇒ fewer Step 1 LLM calls. Pass `**--rollup-to-level 6**` for legacy behavior (every heading is its own section).
   **Manifest metadata:** `sections_manifest.json` includes `manifest_schema_version` (**1.1.0**), `di_page_markers_stripped`, and `rollup_max_section_level` (integer 1–6; use `6` for the former “no rollup” layout). Python callers can pass `rollup_max_section_level=None` to `build_sections_manifest` for JSON `null` and legacy section boundaries.
   **Breaking change:** Changing strip or rollup options changes `section_id` values and sentence IDs. Re-run `**protocol segment`** and `**protocol sections extract`** (or `rules`) after changing these options; existing `step1/*.json` files are no longer aligned.
   The same `**--keep-di-page-markers**` and `**--rollup-to-level**` flags are available on `**pdcheck rules**` (they apply to the segment step only).
4. **Split aCRF by TOC sections** (from extracted `acrf/.../source.md`):
  ```bash
   pdcheck acrf split-toc --study-id MY-STUDY
  ```
   Writes one markdown file per TOC entry under:
   `output/<study_id>/extractions/acrf/layout/rendered/sections_toc/`
   plus `sections_manifest.json` with TOC metadata and detected line ranges.
   Optional flags:
  - `--source-md /path/to/source.md` (override default aCRF markdown input)
  - `--destination-dir /path/to/out` (override output directory)
  - `--no-manifest` (skip `sections_manifest.json`)
5. **Summarize aCRF sections** (LLM structured output + merged summary):
  ```bash
   pdcheck acrf summarize-sections --study-id MY-STUDY
   pdcheck acrf merge-summaries --study-id MY-STUDY
   pdcheck acrf summarize --study-id MY-STUDY
  ```
   Command behavior:
  - `pdcheck acrf summarize-sections --study-id MY-STUDY`
    - Reads split aCRF TOC markdown files from `output/<study_id>/extractions/acrf/layout/rendered/sections_toc/*.md`.
    - Sends each section independently to the LLM for structured dataset/column/type/value-range extraction.
    - Writes per-section JSON files under `output/<study_id>/pipeline/acrf_summary/sections/*.json`.
  - `pdcheck acrf merge-summaries --study-id MY-STUDY`
    - Reads all per-section summary JSONs from `output/<study_id>/pipeline/acrf_summary/sections/`.
    - Validates and merges them into one summary artifact + dataset index.
    - Writes `output/<study_id>/pipeline/acrf_summary/acrf_summary_merged.json`.
  - `pdcheck acrf summarize --study-id MY-STUDY`
    - Convenience command that runs `summarize-sections` then `merge-summaries`.
    - Produces both per-section and merged summary outputs in one run.
     Outputs:
  - `output/<study_id>/pipeline/acrf_summary/sections/*.json`
  - `output/<study_id>/pipeline/acrf_summary/acrf_summary_merged.json`
   Step 1 automatically uses the merged summary as preferred aCRF context when available.
6. **Sections — list / preview / extract**
  ```bash
   pdcheck protocol sections list --study-id MY-STUDY
   pdcheck protocol sections preview --study-id MY-STUDY --section-id sec:abc123def456
   pdcheck protocol sections preview --study-id MY-STUDY --match-regex Inclusion
   pdcheck protocol sections extract --study-id MY-STUDY --all
   pdcheck protocol sections extract --study-id MY-STUDY --section-id sec:abc --skip-regex '^Appendix'
  ```
  **Step 1 (text-first):** each section runs staged plain-text LLM calls (rules → per-rule deviations → programmability with merged aCRF summary by default → pseudo-SQL for programmable cases), then parses blocks into `pipeline/.../step1/*.json` matching `schema_version` **3.0.0**. Step 2 merge/dedup and review UI consume the same merged JSON shape as before (`step2_merged.json`).
  Use `--no-acrf` to omit aCRF context from prompts. Use `--no-use-acrf-summary` to disable merged summary injection even when `pipeline/<study_id>/acrf_summary/acrf_summary_merged.json` exists. By default, merged aCRF summary is attached first when available, then raw aCRF text is used as fallback.
  **Overwrite (default on):** `--overwrite` (default) deletes existing local Step 1 JSON under `pipeline/<study_id>/protocol_sections/step1/` before this run; use `--no-overwrite` to keep orphan files when extracting a subset.
7. **Rules** (shortcut: **segment + extract all sections**):
  ```bash
   pdcheck rules --study-id MY-STUDY
  ```
   `rules` also supports `--use-acrf-summary/--no-use-acrf-summary` (default: use summary) and `--overwrite/--no-overwrite` for the Step 1 extract phase (same semantics as `protocol sections extract`).
8. **Step 2 merge + semantic dedup** (merge all Step 1 section outputs):
  ```bash
   pdcheck step2 --study-id MY-STUDY
  ```
   This stage reads all `protocol_sections/step1/*.json`, removes semantic duplicates
   in rules and their nested candidate deviations, and writes one merged artifact:
   `pipeline/<study_id>/step2/step2_merged.json`.
   Dedup is LLM-assisted, so runtime and token cost are higher than a pure local merge.
   **Overwrite (default on):** `--overwrite` (default) deletes existing local files under `pipeline/<study_id>/step2/` before writing the new merged JSON; use `--no-overwrite` to retain prior DM workbooks or validated outputs in that directory.
9. **Step 2 DM review export** (one deviation per row in Excel):
  ```bash
   pdcheck step2-export-review --study-id MY-STUDY
  ```
   Optional:
  - `--workbook /path/to/review.xlsx` to override output path
  - `--no-upload` for local-only output
   Workbook schema includes DM-editable columns:
  - `validation_status` with allowed values: `accepted`, `to_review`, `rejected`
  - `dm_comments` free text
10. **Step 2 DM review apply + revalidation loop**:
  ```bash
   pdcheck step2-apply-review --study-id MY-STUDY --workbook output/MY-STUDY/pipeline/step2/step2_dm_review.xlsx
  ```
   Behavior:
  - `accepted` deviations remain unchanged.
  - `rejected` deviations are removed from final output.
  - `to_review` deviations are sent back to the LLM with DM comments plus protocol context (and merged aCRF summary unless disabled) and replaced when a valid corrected deviation is returned.
  - Each deviation carries `programmable` (`true`/`false`) for direct testability from captured data context, and `pseudo_sql_logic` (short pseudo-SQL) as an implementation hint for programmed checks.
   Output artifacts:
  - `pipeline/<study_id>/step2/step2_validated.json`
  - `pipeline/<study_id>/step2/step2_validation_audit.json`
  - `pipeline/<study_id>/step2/step2_dm_review.reviewed.xlsx` (only corrected rows highlighted in yellow)
   Optional flags:
  - `--context-mode full_protocol|sections_only` (default `full_protocol`)
  - `--use-acrf-summary/--no-use-acrf-summary` (default enabled)
  - `--strict` (fail when unresolved `to_review` rows remain)
  - `--no-upload`
**Removed CLI stubs:** `draft-pd`, `merge`, `export-review`, `apply-review`, and `emit-pseudo` invoke Typer but only raise an error pointing at the Step 1/2 commands above (the old rules-KB → PD-candidate pipeline code and schemas were removed).

**End-to-end** through Step 1 (extract PDFs → aCRF summarize → segment → LLM per section):

```bash
pdcheck run-all --study-id MY-STUDY
```

(`run-all` still requires aCRF extraction today because it calls `extract` without `--skip-acrf` and then executes `acrf split-toc` + `acrf summarize`.)

`run-all` accepts `--overwrite/--no-overwrite` and passes it through to the Step 1 extract inside `rules` (same as `protocol sections extract`).

Use `--no-upload` on any command to only write under `output/` without Blob uploads.

Clear local outputs for one stage:

```bash
pdcheck clear-stage --study-id MY-STUDY --stage extraction
pdcheck clear-stage --study-id MY-STUDY --stage step1
pdcheck clear-stage --study-id MY-STUDY --stage step2
pdcheck clear-stage --study-id MY-STUDY --stage step1 --blob
pdcheck clear-stage --study-id MY-STUDY --stage step2 --blob
```

## Sentence splitting

Section bodies are split into sentences with **stdlib heuristics** (including keeping fenced ``` blocks intact). Complex protocol typography may produce imperfect boundaries; sentence IDs remain stable for a given manifest.

## JSON schemas

- `schemas/protocol_section_step1.schema.json` — Step 1 output per section (`schema_version` **3.0.0**, text-first multi-call pipeline; same rule/deviation object shape for Step 2 merge)
- `schemas/acrf_section_summary.schema.json` — aCRF summary per TOC section (`schema_version` **1.0.0**)
- `schemas/acrf_section_summaries_merged.schema.json` — merged aCRF summaries (`schema_version` **1.0.0**)
- `schemas/protocol_sections_step2_merged.schema.json` — Step 2 merged output (`schema_version` **2.1.1**)

## LLM prompts

System and user instructions for Azure OpenAI are Markdown files under `[pdcheck_factory/prompts/](pdcheck_factory/prompts/)`. Step 1 uses `section_step1_system.md` and `section_step1_user.md`; aCRF summary uses `acrf_section_summary_system.md` and `acrf_section_summary_user.md`; Step 2 review revalidation uses `step2_revalidate_deviation_system.md` and `step2_revalidate_deviation_user.md`. Input size limits remain enforced in `[pdcheck_factory/llm.py](pdcheck_factory/llm.py)`.

## License

See repository owner for license terms.

## React UI (Vite + TypeScript)

A new single-page React dashboard scaffold is available under `frontend/`.

### Frontend structure

- `frontend/src/pages/HomePage.tsx` — single-page dashboard flow.
- `frontend/src/components/layout/` — shared layout primitives (`Page`, `Section`, `Card`, `Stack`).
- `frontend/src/components/ui/` — typed presentational UI components.
- `frontend/src/hooks/useStudyDashboard.ts` — state orchestration for loading/filter/refresh.
- `frontend/src/services/studyService.ts` — mock data service (replace with real API next).
- `frontend/src/pages/HomePage.test.tsx` — primary integration path tests.

### Run locally

```bash
# terminal 1: start step API for upload/extract
pdcheck ui step-api --host 127.0.0.1 --port 8787 --output-dir output

# terminal 2: run React UI
cd frontend
npm install
npm run dev
```

### Quality commands

```bash
npm run lint
npm run test
npm run build
```

### Step API endpoints (React integration)

- `POST /api/v1/studies/{studyId}/step1/upload`
- `POST /api/v1/studies/{studyId}/step1/extract`
- `GET /api/v1/studies/{studyId}/step1/preview`
- `GET /api/v1/studies/{studyId}/steps/status`
- `POST /api/v1/studies/{studyId}/steps/{stepId}/run`
- `GET /api/v1/studies/{studyId}/steps/{stepId}/preview`

### Troubleshooting (`Failed to fetch`)

- Verify the Step API process is running and reachable:
  - `curl "http://127.0.0.1:8787/api/v1/studies/MY-STUDY/steps/status"`
- Ensure `VITE_PD_API_BASE` points to the API host/port if not using defaults.
- Check `.env` values required by extraction (`STORAGE_CONNECTION_STRING`, `STORAGE_CONTAINER`, `DI_ENDPOINT`, `DI_KEY`).
- If running frontend/API in different network contexts, bind API to `0.0.0.0` and use a reachable host IP in `VITE_PD_API_BASE`.
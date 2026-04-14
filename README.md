# PD Check Factory

Single **Python** application to extract text and tables from clinical trial **protocol** and **annotated CRF (aCRF)** PDFs with **Azure AI Document Intelligence**, segment the protocol Markdown into sections with **numbered sentences**, run **Step 1 Azure OpenAI extraction** (atomic protocol rules plus per-rule nested candidate deviations and short violation examples per section), run **Step 2 semantic merge/dedup**, support **DM Excel validation round-trip**, and optionally upload artifacts to Blob.

**Current scope:** Step 1 extraction, Step 2 merge/dedup, and DM validation round-trip (`step2-export-review`, `step2-apply-review`) for protocol deviations. Legacy v1 pseudo-logic commands remain out of the default path.

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

JSON schemas are loaded from the repo `schemas/` directory (project root). Prefer **editable installs** from a checkout so validation always finds those files.

## Configuration

Copy `.env.example` to `.env` and fill in endpoints and keys. The CLI loads `.env` via `python-dotenv`.

## Blob layout (prefixes in your container)

| Purpose | Path |
|--------|------|
| Raw PDF uploads | `raw/<study_id>/protocol.pdf`, `raw/<study_id>/acrf.pdf` |
| DI outputs | `extractions/<study_id>/protocol/layout/...`, `extractions/<study_id>/acrf/layout/...` |
| Protocol sections (Step 1) | `pipeline/<study_id>/protocol_sections/sections_manifest.json`, `pipeline/<study_id>/protocol_sections/step1/<section_id>.json` |
| Protocol sections (Step 2 merged) | `pipeline/<study_id>/step2/step2_merged.json` |
| Step 2 DM workbook (export) | `pipeline/<study_id>/step2/step2_dm_review.xlsx` |
| Step 2 DM outputs (apply) | `pipeline/<study_id>/step2/step2_validated.json`, `pipeline/<study_id>/step2/step2_validation_audit.json`, `pipeline/<study_id>/step2/step2_dm_review.reviewed.xlsx` |
| Legacy v1 PD JSON (unused by default) | `pipeline/<study_id>/pd/...` |
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

3. **Segment protocol** (headings → sections, sentences enumerated with stable IDs):

   ```bash
   pdcheck protocol segment --study-id MY-STUDY
   ```

   Writes `pipeline/<study_id>/protocol_sections/sections_manifest.json` and human-readable numbered fragments under `protocol_sections/raw/`.

   **DI page noise (default: strip):** By default, Azure DI HTML comments such as `PageHeader`, `PageFooter`, `PageNumber`, and `PageBreak` are removed from the markdown before parsing. Use **`--keep-di-page-markers`** to preserve them (e.g. for debugging).

   **Rollup (optional):** **`--rollup-to-level N`** (1–6) keeps only `#` … `N`-hash headings as separate manifest sections; deeper headings are inlined into the parent section body as ATX lines (`### Child title`, …). Fewer sections ⇒ fewer Step 1 LLM calls. Omit the flag for legacy behavior (every heading is its own section).

   **Manifest metadata:** `sections_manifest.json` includes `manifest_schema_version` (**1.1.0**), `di_page_markers_stripped`, and `rollup_max_section_level` (JSON `null` when not using rollup).

   **Breaking change:** Changing strip or rollup options changes `section_id` values and sentence IDs. Re-run **`protocol segment`** and **`protocol sections extract`** (or `rules`) after changing these options; existing `step1/*.json` files are no longer aligned.

   The same **`--keep-di-page-markers`** and **`--rollup-to-level`** flags are available on **`pdcheck rules`** (they apply to the segment step only).

4. **Sections — list / preview / extract**

   ```bash
   pdcheck protocol sections list --study-id MY-STUDY
   pdcheck protocol sections preview --study-id MY-STUDY --section-id sec:abc123def456
   pdcheck protocol sections preview --study-id MY-STUDY --match-regex Inclusion
   pdcheck protocol sections extract --study-id MY-STUDY --all
   pdcheck protocol sections extract --study-id MY-STUDY --section-id sec:abc --skip-regex '^Appendix'
   ```

   Use `--no-acrf` to omit aCRF context from prompts. If `acrf/.../source.md` exists, its text is appended (truncated) for realistic deviation wording only—not for field-level mapping.

5. **Rules** (shortcut: **segment + extract all sections**):

   ```bash
   pdcheck rules --study-id MY-STUDY
   ```

6. **Step 2 merge + semantic dedup** (merge all Step 1 section outputs):

   ```bash
   pdcheck step2 --study-id MY-STUDY
   ```

   This stage reads all `protocol_sections/step1/*.json`, removes semantic duplicates
   in rules and their nested candidate deviations, and writes one merged artifact:
   `pipeline/<study_id>/step2/step2_merged.json`.
   Dedup is LLM-assisted, so runtime and token cost are higher than a pure local merge.

7. **Step 2 DM review export** (one deviation per row in Excel):

   ```bash
   pdcheck step2-export-review --study-id MY-STUDY
   ```

   Optional:
   - `--workbook /path/to/review.xlsx` to override output path
   - `--no-upload` for local-only output

   Workbook schema includes DM-editable columns:
   - `validation_status` with allowed values: `accepted`, `to_review`, `rejected`
   - `dm_comments` free text

8. **Step 2 DM review apply + revalidation loop**:

   ```bash
   pdcheck step2-apply-review --study-id MY-STUDY --workbook output/MY-STUDY/pipeline/step2/step2_dm_review.xlsx
   ```

   Behavior:
   - `accepted` deviations remain unchanged.
   - `rejected` deviations are removed from final output.
   - `to_review` deviations are sent back to the LLM with DM comments plus protocol context and replaced when a valid corrected deviation is returned.

   Output artifacts:
   - `pipeline/<study_id>/step2/step2_validated.json`
   - `pipeline/<study_id>/step2/step2_validation_audit.json`
   - `pipeline/<study_id>/step2/step2_dm_review.reviewed.xlsx` (only corrected rows highlighted in yellow)

   Optional flags:
   - `--context-mode full_protocol|sections_only` (default `full_protocol`)
   - `--strict` (fail when unresolved `to_review` rows remain)
   - `--no-upload`

**Removed / stale in Step 1:** `draft-pd`, `merge`, `export-review`, `apply-review`, and `emit-pseudo` still target the legacy v1 pipeline and remain disabled.

**End-to-end** through Step 1 (extract PDFs → segment → LLM per section):

```bash
pdcheck run-all --study-id MY-STUDY
```

(`run-all` still requires aCRF extraction today because it calls `extract` without `--skip-acrf`.)

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

- `schemas/protocol_section_step1.schema.json` — Step 1 output per section (`schema_version` **2.0.0**)
- `schemas/protocol_sections_step2_merged.schema.json` — Step 2 merged output (`schema_version` **2.1.0**)
- `schemas/protocol_rules_kb.schema.json`, `schemas/pd_candidate_output.schema.json`, `schemas/pd_logic_output.schema.json`, `schemas/pd_draft_spec.schema.json` — retained for reference / future Phase 2; not produced by the default Step 1 CLI path

## LLM prompts

System and user instructions for Azure OpenAI are Markdown files under [`pdcheck_factory/prompts/`](pdcheck_factory/prompts/). Step 1 uses `section_step1_system.md` and `section_step1_user.md`; Step 2 review revalidation uses `step2_revalidate_deviation_system.md` and `step2_revalidate_deviation_user.md`. Input size limits remain enforced in [`pdcheck_factory/llm.py`](pdcheck_factory/llm.py).

## License

See repository owner for license terms.

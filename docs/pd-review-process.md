# PD Specification Review Process

## Reference assets

Official template and taxonomy live in:

- `docs/refernce-files/NAL00-107 PD Specifications.xlsx`
- `docs/refernce-files/protocol_deviation_category_subcategory_table.pdf`

Machine-readable taxonomy is generated to:

- `pdcheck_factory/data/pd_category_subcategory.json`
- `pdcheck_factory/data/pd_spec_template_meta.json`

Regenerate after template updates:

```bash
python scripts/extract_pd_taxonomy.py
```

## Generated artifact locations

Per study under `output/<study_id>/`:

| Artifact | Path |
|---|---|
| Final PD spec JSON | `pipeline/final/final_deviations.json` |
| Final PD spec XLSX | `pipeline/final/final_deviations.xlsx` |
| Model output log | `pipeline/review/model_output_log.json` |
| Classification audit | `pipeline/review/deviation_classification_audit.json` |
| Consolidation audit | `pipeline/review/deviation_consolidation_audit.json` |

Generated XLSX contains **only** the `PD Specifications` sheet.

## Review workflow

1. Data Analyst generates outputs via Pipeline V2 (through Step 10 finalize).
2. Andrzej/Oliwia review in Step 7 UI and via exported XLSX.
3. Comments collected in Step 7 `dm_comment` and review tracker.
4. Run validation before upload:

```bash
pdcheck v2 validate --study-id <STUDY_ID>
pdcheck v2 ready-for-review --study-id <STUDY_ID>
```

5. Post review drafts to SharePoint **Internal Documents** (not PD Library).
6. After CTL/DM sign-off, post finalized specs to **Data Analytics → Documents → PD Library**.

## Promotion criteria

Outputs are ready for DM/study-team use when:

- Latest NAL00-107-based template used
- Category/sub-category values from approved taxonomy (or blank)
- Descriptions not truncated; soft 250-char warnings reviewed
- Visit-window checks present when protocol schedule exists
- Programmer Comments, Reviewer Comments, and Programmer Check Number blank in export
- `pdcheck v2 ready-for-review` passes

## Universal vs specific checks

Prefer broad programmable checks parameterized by visit/procedure/assessment when logic is identical. Create specific checks only when clinical or programming logic genuinely differs.

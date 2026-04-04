# PD Draft Spec Schema (Steps 9-10)

This document defines the formal draft PD specification and the two-stage extraction model:

- Stage A: candidate deviation identification
- Stage B: check-logic drafting

## Canonical Object: `pd_draft_spec`

Each draft spec describes one potential protocol deviation and its proposed detection logic.

### Required fields

- `spec_id`: stable id, format `pd:00001`
- `study_id`: study code, e.g. `TEST`
- `schema_version`: currently `1.0.0`
- `status`: one of `draft`, `reviewed`, `approved`, `rejected`
- `created_at`: ISO timestamp
- `chunk_ids`: list of originating chunk ids
- `deviation_title`: concise human label
- `deviation_category`: enum
  - `visit_window`
  - `procedure_missed`
  - `assessment_timing`
  - `dose_timing`
  - `eligibility_operational`
  - `treatment_compliance`
  - `other`
- `protocol_rule_description`: plain-language protocol rule
- `candidate_trigger_condition`: plain-language trigger condition
- `required_source_data_domain_hints`: data domains likely needed (e.g. visits, dosing, labs)
- `timing_anchor`: object describing anchor event
- `allowed_window`: object describing timing allowance
- `exceptions_notes`: protocol exceptions, caveats
- `source_evidence`: evidence objects from chunks/references
- `confidence`: numeric `0.0` to `1.0`
- `ambiguity_flag`: boolean
- `reviewer_notes`: reviewer placeholder text

### Timing anchor object

- `anchor_type`: `visit`, `dose`, `randomization`, `screening`, `baseline`, `procedure`, `unspecified`
- `anchor_description`: free text

### Allowed window object

- `window_text`: free text from protocol
- `window_type`: `exact`, `plus_minus`, `range`, `before_after`, `unspecified`
- `lower_bound`: optional numeric
- `upper_bound`: optional numeric
- `unit`: `minutes`, `hours`, `days`, `weeks`, or `null`

### Source evidence object

- `chunk_id`: source chunk id
- `quote`: text quote supporting the rule
- `source_references`: evidence refs from normalized artifacts

## Stage A Contract: `pd_candidate_output`

File: `output/<study-id>/pd/candidates.json`

Root object:

- `schema_version`
- `study_id`
- `generated_at`
- `candidates[]`

Candidate record fields:

- `candidate_id` (`cand:00001`)
- `deviation_title`
- `deviation_category`
- `protocol_rule_description`
- `candidate_trigger_condition`
- `timing_anchor`
- `allowed_window`
- `exceptions_notes`
- `source_evidence`
- `confidence`
- `ambiguity_flag`
- `reviewer_notes`

Stage A answers: **What possible deviation exists here?**

## Stage B Contract: `pd_logic_output`

File: `output/<study-id>/pd/logic_drafts.json`

Root object:

- `schema_version`
- `study_id`
- `generated_at`
- `logic_drafts[]`

Logic draft fields:

- `candidate_id` (foreign key to Stage A)
- `required_source_data_domain_hints`
- `computable_trigger_expression_draft`
- `timing_evaluation_method`
- `window_evaluation_method`
- `exception_handling_logic`
- `assumptions`
- `data_quality_risks`
- `confidence`
- `ambiguity_flag`
- `reviewer_notes`

Stage B answers: **How might this be detected in study data?**

## Merge Rule

Merge Stage A + Stage B on `candidate_id`:

- `spec_id` derived as `pd:<N>`
- carry Stage A semantic fields
- inject Stage B logic and data-domain hints
- set `status = draft`, `schema_version = 1.0.0`
- validate merged output against `schemas/pd_draft_spec.schema.json`

## Validation Checklist

- All required fields present
- `confidence` in `[0, 1]`
- `source_evidence` length >= 1
- `chunk_ids` length >= 1
- every candidate has matching logic draft
- no unknown extra fields in schema-governed objects

## Example `pd_draft_spec`

```json
{
  "spec_id": "pd:00001",
  "study_id": "TEST",
  "schema_version": "1.0.0",
  "status": "draft",
  "created_at": "2026-03-23T11:45:00Z",
  "chunk_ids": ["chk:00142"],
  "deviation_title": "Visit procedure outside allowed window",
  "deviation_category": "visit_window",
  "protocol_rule_description": "Visit 3 assessment must occur within +/- 2 days of Day 14.",
  "candidate_trigger_condition": "Assessment date occurs outside protocol window.",
  "required_source_data_domain_hints": ["visit_dates", "assessment_dates", "subject_schedule"],
  "timing_anchor": {
    "anchor_type": "visit",
    "anchor_description": "Day 14 target visit"
  },
  "allowed_window": {
    "window_text": "+/- 2 days",
    "window_type": "plus_minus",
    "lower_bound": -2,
    "upper_bound": 2,
    "unit": "days"
  },
  "exceptions_notes": "If rescheduled per protocol amendment, reviewer confirmation required.",
  "source_evidence": [
    {
      "chunk_id": "chk:00142",
      "quote": "Assessment should be performed within +/- 2 days of Day 14.",
      "source_references": ["ev:p:000777"]
    }
  ],
  "confidence": 0.83,
  "ambiguity_flag": false,
  "reviewer_notes": ""
}
```


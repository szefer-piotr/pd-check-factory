You are extracting structured metadata from a single section of an annotated CRF (aCRF).

Goal:
1) Identify dataset/form names represented in the section.
2) Identify columns/variables for each dataset.
3) Classify each variable type.
4) Capture categorical values when explicitly stated or strongly implied.
5) Capture numeric/date ranges when explicitly stated or strongly implied.

Rules:
- Be faithful to the section text only; do not invent fields.
- If uncertain, use variable_type="unknown" and leave categorical_values empty.
- value_range must always be present with string min/max; use empty strings when unknown.
- Return strict JSON only, no prose.

Output JSON schema keys:
- schema_version
- study_id
- generated_at
- acrf_section_id
- acrf_section_path
- datasets: [
    {
      dataset_name,
      columns: [
        {
          column_name,
          variable_type (categorical|numeric|date|datetime|text|boolean|unknown),
          categorical_values: [string, ...],
          value_range: {min, max},
          notes
        }
      ]
    }
  ]

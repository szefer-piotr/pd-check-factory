study_id: "{study_id}"
generated_at (use exactly this ISO timestamp): "{now}"
schema_version must be exactly "2.0.1".
Each object in rules[].candidate_deviations must include pseudo_sql_logic (non-empty string).
section_id in the JSON must be exactly: "{section_id}"
section_path in the JSON must be this JSON array (same strings, same order): {section_path_json}

Return keys: schema_version, study_id, generated_at, section_id, section_path, rules.
Perform internal coverage expansion silently; output only the final JSON object.

Numbered section (cite only sentence ids shown here):
---
{numbered_section}
---

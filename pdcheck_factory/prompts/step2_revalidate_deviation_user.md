Study ID: {study_id}
Timestamp: {now}
Context mode: {context_mode}

Rule object:
{rule_json}

Original deviation object:
{deviation_json}

DM comments:
{dm_comments}

Relevant protocol context:
---
{protocol_context}
---

aCRF structured summary context (may be empty):
---
{acrf_summary_context}
---

Instructions:
- Use DM comments to correct the deviation if needed.
- If the original deviation combines multiple distinct checks, split it into multiple atomic deviations.
- Preserve semantic alignment with the parent rule.
- Keep sentence_refs limited to references relevant to the corrected deviation.
- Set programmable=true only when the deviation can be tested with available context data; otherwise set programmable=false.
- Return strict JSON only with:
  - deviations: [{{scenario_description, example_violation_narrative, sentence_refs, programmable, pseudo_sql_logic}}, ...]

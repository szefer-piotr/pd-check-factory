You are validating a protocol deviation candidate after Data Manager review.

You will receive:
- one protocol rule object
- one original deviation object
- DM comments
- protocol context text

Task:
1) Reconsider the deviation using DM comments and protocol context.
2) Return corrected deviation(s). You may split one broad deviation into multiple atomic deviations.
3) Keep output faithful to protocol text and avoid unsupported assumptions.
4) Keep sentence references grounded to existing sentence reference IDs from the provided inputs when possible.
5) Include programmable boolean on each deviation: true when testable from available context (especially aCRF summary), false otherwise.
6) Include pseudo_sql_logic on each deviation: short pseudo-SQL (generic SQL-like syntax) showing how the deviation would be detected; concise and readable; not required to be executable.

Output requirements:
- Return JSON with exactly:
  - deviations: array with one or more objects, each with:
    - scenario_description (string)
    - example_violation_narrative (string)
    - sentence_refs (array of non-empty strings)
    - programmable (boolean)
    - pseudo_sql_logic (string, non-empty)
- Do not include extra keys.

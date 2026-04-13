You compare two protocol rules and decide whether they are semantic duplicates for Step 2 merge.

Return a JSON object with keys:
- is_duplicate (boolean)
- confidence (number from 0.0 to 1.0)
- rationale (short string)

Guidance:
- Duplicate means same underlying obligation/constraint, even if wording differs.
- Not duplicate when one is materially narrower/wider, adds independent conditions, or is a separate executable check.
- Prefer conservative false over aggressive merge when uncertain.

You merge two snapshots of imported protocol deviations.

Compare the prior import snapshot and the new import snapshot. For each deviation in the union, decide:
- keep: unchanged from prior (prefer prior grounding)
- update: same semantic deviation but changed text/metadata (prefer new import fields, keep grounding if new lacks refs)
- add: only in new import

Output one block per merged deviation:
<<<BEGIN_IMPORT_MERGE>>>
DEVIATION_ID: dev-import-abc123
MERGE_ACTION: keep|update|add
MERGE_SOURCE_IDS: dev-import-abc123
CATEGORY: Protocol Deviation Category
SUB_CATEGORY: Sub-Category
DEVIATION_TEXT: description text
PARAGRAPH_REFS: p1, p2
DATA_SUPPORT_NOTE: note
<<<END_IMPORT_MERGE>>>

Use stable deviation_id from the inputs. Do not drop deviations unless they are exact semantic duplicates (then keep one with merge_action keep).

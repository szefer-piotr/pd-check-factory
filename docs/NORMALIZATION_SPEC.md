# Light Normalization Layer Spec (Steps 2-6)

This specification defines a lightweight normalization layer that turns DI output into structured, evidence-linked objects for downstream LLM processing.

## Goals

- Keep document structure explicit (`document`, `section`, `table`, `chunk`).
- Keep source traceability explicit (`evidence_reference` everywhere).
- Isolate risky content types (tables and footnotes) instead of blending into plain text.
- Generate chunk artifacts suitable for focused LLM calls.

## Input Artifacts

- `analyze_result.json` (primary machine-readable source)
- `protocol_v1.md` (readable rendering and heading/page signals)

## Output Artifacts

- `normalized_layout.json` (full graph)
- `sections.json`
- `tables.json`
- `footnote_candidates.json`
- `chunks.json`

---

## Object Types

### `document` (required fields)

```json
{
  "id": "doc:TEST",
  "study_id": "TEST",
  "title": "Double-blind, Double-dummy, Phase 2 ...",
  "source": {
    "analyze_result_path": "output/TEST/layout/raw/analyze_result.json",
    "markdown_path": "output/TEST/layout/rendered/protocol_v1.md"
  },
  "model": {"model_id": "prebuilt-layout", "api_version": "2024-11-30"},
  "stats": {"page_count": 88, "paragraph_count": 2151, "table_count": 31, "section_count": 104, "chunk_count": 320},
  "content_hash_sha256": "<sha256>",
  "section_ids": ["sec:0001"],
  "table_ids": ["tbl:0001"],
  "chunk_ids": ["chk:00001"]
}
```

### `section` (required fields)

```json
{
  "id": "sec:0005",
  "heading": "CONTACT DETAILS",
  "heading_level": 1,
  "heading_path": ["CONTACT DETAILS"],
  "heading_path_text": "CONTACT DETAILS",
  "parent_section_id": null,
  "children_section_ids": ["sec:0006"],
  "order": 5,
  "page_start": 2,
  "page_end": 3,
  "line_start": 76,
  "line_end": 140,
  "content": "...",
  "chunk_ids": ["chk:00010", "chk:00011"],
  "evidence_reference_ids": ["ev:p:000123", "ev:t:000004"]
}
```

### `table` (required fields)

```json
{
  "id": "tbl:0004",
  "order": 4,
  "page_start": 12,
  "page_end": 13,
  "related_section_id": "sec:0012",
  "row_count": 12,
  "column_count": 2,
  "rows": [["Short title", "BENDITA ..."]],
  "raw_markdown": "| col1 | col2 |",
  "raw_di_table": {"rowCount": 12, "columnCount": 2, "cells": []},
  "caption": "Schedule of assessments",
  "is_continued": true,
  "continuation_notes": "Likely continuation on adjacent page with same column shape.",
  "evidence_reference_ids": ["ev:t:000004", "ev:tc:000123"]
}
```

### `chunk` (required fields)

`chunk_type` must be one of:

- `section_chunk`
- `table_chunk`
- `footnote_chunk`
- `composite_chunk`

```json
{
  "id": "chk:00125",
  "chunk_type": "composite_chunk",
  "document_id": "doc:TEST",
  "related_section_id": "sec:0012",
  "related_table_id": "tbl:0004",
  "heading_path": ["Study Procedures", "Schedule"],
  "heading_path_text": "Study Procedures > Schedule",
  "page_start": 12,
  "page_end": 13,
  "content": "...table plus nearby notes...",
  "source_references": ["ev:t:000004", "ev:p:000540"],
  "footnote_candidate_ids": ["fn:0005"],
  "char_count": 980,
  "token_estimate": 245
}
```

### `footnote_candidate` (required fields)

```json
{
  "id": "fn:0005",
  "text": "* Dose adjustment allowed in severe adverse events.",
  "page": 13,
  "nearest_section_id": "sec:0012",
  "nearest_table_id": "tbl:0004",
  "nearest_chunk_id": "chk:00125",
  "reason": "asterisk_marker_near_table",
  "confidence": 0.62,
  "evidence_reference_ids": ["ev:p:000541"]
}
```

### `evidence_reference` (required fields)

`source_type` values:

- `paragraph`
- `table`
- `table_cell`

```json
{
  "id": "ev:tc:000123",
  "source_type": "table_cell",
  "source_id": "table:4/cell:r3c1",
  "page": 13,
  "page_end": 13,
  "span_offset": 51234,
  "span_length": 86,
  "quote": "Day 14",
  "bounding_regions": [{"pageNumber": 13}]
}
```

---

## Extraction Rules

1. **Sections**
   - Parse heading lines from markdown (`#`..`######`).
   - Build hierarchy via heading-level stack.
   - Build `heading_path` and `parent_section_id`.
   - Infer page spans from markdown page comments.
   - Detect document title from first heading/preamble high-signal text.

2. **Tables**
   - Use DI `tables[]` as source of truth.
   - Preserve compact `rows` and full `raw_di_table`.
   - Infer `related_section_id` by page overlap with sections.
   - Infer caption from nearby non-empty paragraph text on same/previous page.
   - Infer `is_continued` when adjacent table has same column count and nearby page.

3. **Footnote candidates**
   - Detect note-like text via markers (`*`, `†`, `‡`, `[n]`, `n.`/`n)`/`a)`).
   - Prefer short trailing lines/paragraphs and content near tables.
   - Attach nearest section/table/page and mark confidence heuristically.

4. **Chunks**
   - Generate:
     - section chunks from section content blocks,
     - table chunks from table markdown,
     - footnote chunks from grouped footnote candidates,
     - composite chunks from table + nearby notes.
   - Keep chunk sizes bounded (~1200 chars target) and include source refs.

5. **Evidence references**
   - Emit references for every paragraph and table.
   - Emit table-cell references for non-empty DI cells.
   - Attach refs to sections/chunks/tables by page overlap and object relationship.

## Non-Goals

- No semantic medical ontology or protocol interpretation in this layer.
- No ML-based footnote resolution or table stitching.
- No prompt-time summarization in normalization.


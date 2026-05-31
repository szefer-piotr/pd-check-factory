from __future__ import annotations

from pdcheck_factory.deviation_contract import (
    build_enriched_row,
    has_flat_pd_spec_fields,
    lift_pd_spec_row,
    merge_canonical_updates,
    split_pd_spec_row,
)


def test_split_pd_spec_row_nests_import_fields() -> None:
    flat = {
        "deviation_id": "dev-1",
        "rule_id": "rule-1",
        "text": "Composite text",
        "paragraph_refs": [],
        "protocol_deviation_category": "Visit",
        "entry_source": "imported_pd_spec",
    }
    nested = split_pd_spec_row(flat)
    assert nested["text"] == "Composite text"
    assert nested["pd_spec_import"]["protocol_deviation_category"] == "Visit"
    assert "protocol_deviation_category" not in nested


def test_merge_preserves_original_deviation_text() -> None:
    row = split_pd_spec_row(
        {
            "deviation_id": "dev-1",
            "rule_id": "rule-1",
            "text": "Updated",
            "original_deviation_text": "Original",
            "paragraph_refs": [],
            "entry_source": "imported_pd_spec",
        }
    )
    updated = merge_canonical_updates(row, {"text": "New text"}, for_enriched=True)
    assert updated["text"] == "New text"
    assert updated["original_deviation_text"] == "Original"


def test_lift_pd_spec_row_in_place() -> None:
    row = {
        "deviation_id": "dev-1",
        "rule_id": "rule-1",
        "text": "t",
        "paragraph_refs": [],
        "classification": "Major",
    }
    assert has_flat_pd_spec_fields(row)
    lift_pd_spec_row(row)
    assert row["pd_spec_import"]["classification"] == "Major"
    assert not has_flat_pd_spec_fields(row)


def test_build_enriched_row_sets_original_from_text() -> None:
    base = split_pd_spec_row(
        {
            "deviation_id": "dev-1",
            "rule_id": "rule-1",
            "text": "Import text",
            "paragraph_refs": [],
            "entry_source": "imported_pd_spec",
        }
    )
    result = build_enriched_row(base, {"text": "Enriched text"})
    assert result["original_deviation_text"] == "Import text"
    assert result["text"] == "Enriched text"

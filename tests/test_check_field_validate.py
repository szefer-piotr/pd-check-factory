from pdcheck_factory.check_field_validate import extract_field_references, validate_field_references


def test_validate_field_references_flags_unknown_columns() -> None:
    dictionary = {
        "datasets": [
            {
                "dataset_name": "VS",
                "fields": [{"column_name": "VISIT", "label": "Visit", "type": "categorical"}],
            }
        ],
        "field_index": {
            "VS.VISIT": {
                "dataset_name": "VS",
                "column_name": "VISIT",
                "label": "Visit",
                "type": "categorical",
            },
            "VISIT": {
                "dataset_name": "VS",
                "column_name": "VISIT",
                "label": "Visit",
                "type": "categorical",
            },
        },
    }
    refs = extract_field_references(
        pseudo_logic="VS: FAKECOL IS NULL WHERE VISIT = 'Week 4'",
        dictionary_obj=dictionary,
    )
    assert any(ref["column_name"] == "FAKECOL" for ref in refs)
    result = validate_field_references(
        dictionary_obj=dictionary,
        pseudo_logic="VS: FAKECOL IS NULL WHERE VISIT = 'Week 4'",
    )
    assert result["needs_mapping_review"] is True
    assert result["invalid_fields"]

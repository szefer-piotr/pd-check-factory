from pdcheck_factory.acrf_field_dictionary import build_field_dictionary, compact_dictionary_for_prompt


def test_build_field_dictionary_merges_duplicate_columns() -> None:
    summary = {
        "datasets": [
            {
                "dataset_name": "VS",
                "columns": [
                    {
                        "column_name": "VISIT",
                        "column_description": "Visit",
                        "column_values": "categorical",
                    },
                    {
                        "column_name": "visit",
                        "column_description": "Visit Name",
                        "column_values": "Baseline, Week 4",
                    },
                ],
            },
            {
                "dataset_name": "vs",
                "columns": [
                    {
                        "column_name": "VSDTC",
                        "column_description": "Assessment datetime",
                        "column_values": "datetime",
                    }
                ],
            },
        ]
    }
    out = build_field_dictionary(study_id="study-1", summary_obj=summary)
    assert len(out["datasets"]) == 1
    assert out["datasets"][0]["dataset_name"] == "VS"
    field_names = {field["column_name"] for field in out["datasets"][0]["fields"]}
    assert field_names == {"VISIT", "VSDTC"}
    assert "VS.VISIT" in out["field_index"]
    assert compact_dictionary_for_prompt(out)


def test_compact_dictionary_for_prompt_never_truncates() -> None:
    """Large dictionaries must be passed in full to LLM prompts."""
    fields = [
        {
            "column_name": f"COL{i:04d}",
            "label": f"Field label {i} " + ("x" * 80),
            "type": "text",
        }
        for i in range(800)
    ]
    dictionary = {
        "schema_version": "1.0.0",
        "study_id": "study-large",
        "generated_at": "2026-01-01T00:00:00+00:00",
        "datasets": [{"dataset_name": "DS", "form_name": "Demo", "fields": fields}],
        "field_index": {
            f"DS.COL{i:04d}": {
                "dataset_name": "DS",
                "column_name": f"COL{i:04d}",
                "label": fields[i]["label"],
                "type": "text",
            }
            for i in range(800)
        },
        "normalization_warnings": [],
    }
    text = compact_dictionary_for_prompt(dictionary)
    assert len(text) > 50000
    assert "COL0799" in text
    assert text.endswith("}")

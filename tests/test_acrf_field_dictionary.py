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

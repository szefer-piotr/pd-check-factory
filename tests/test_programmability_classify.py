from pdcheck_factory.programmability_classify import apply_deterministic_overrides


def test_subjective_text_forces_manual() -> None:
    out = apply_deterministic_overrides(
        classification={
            "programmability": "programmable",
            "reason": "initial",
            "required_data": ["VS.VISIT"],
            "available_data": ["VS.VISIT"],
            "missing_data": [],
        },
        deviation_text="Requires investigator clinical judgement to confirm.",
        dictionary_obj={"field_index": {"VS.VISIT": {"dataset_name": "VS", "column_name": "VISIT"}}},
    )
    assert out["programmability"] == "manual"
    assert out["manual_or_programmable"] == "Manual"

from __future__ import annotations

from pathlib import Path

from pdcheck_factory.acrf_field_dictionary import build_field_dictionary
from pdcheck_factory.acrf_xls_extract import build_acrf_summary_text_merged_from_workbook_bytes
from pdcheck_factory.json_util import load_schema, validate


def _get_column(summary: dict, *, dataset_name: str, column_name: str) -> dict | None:
    for ds in summary.get("datasets", []):
        if ds.get("dataset_name") != dataset_name:
            continue
        for col in ds.get("columns", []):
            if col.get("column_name") == column_name:
                return col
    return None


def _validate_field_dictionary_schema(*, study_id: str, summary: dict) -> None:
    dictionary = build_field_dictionary(study_id=study_id, summary_obj=summary)
    errs = validate(dictionary, load_schema("acrf_field_dictionary.schema.json"))
    assert errs == [], f"Schema validation failed: {errs[:10]}"


def test_acrf_xlsx_minimal_fixture_emits_stable_mapping_and_schema() -> None:
    fixture_path = Path("tests/fixtures/acrf_xls_minimal.xlsx")
    workbook_bytes = fixture_path.read_bytes()

    summary = build_acrf_summary_text_merged_from_workbook_bytes(
        workbook_bytes=workbook_bytes, file_format="xlsx", study_id="fixture-xlsx"
    )

    # Deterministic FormOID/FieldOID mapping from spreadsheet headers.
    assert _get_column(summary, dataset_name="VIST", column_name="VISITDAT") is not None

    col = _get_column(summary, dataset_name="VIST", column_name="VISITDAT")
    assert col is not None
    assert col.get("column_type") == "datetime"
    assert "Unit:" in str(col.get("column_description") or "")
    assert "cm" in str(col.get("column_description") or "")

    _validate_field_dictionary_schema(study_id="fixture-xlsx", summary=summary)


def test_acrf_xls_real_samples_emit_stable_mapping_and_schema() -> None:
    samples = [
        (
            "TARA",
            Path("test_input/TARA-002-201_v4.02_UAT_Amend23Jun_1JUL2026_CP.xls"),
        ),
        (
            "TNX",
            Path("test_input/TNX-CY-MD201_V1.00_PROD_2026-05-07_CP.xls"),
        ),
    ]

    for study_id, path in samples:
        workbook_bytes = path.read_bytes()
        summary = build_acrf_summary_text_merged_from_workbook_bytes(
            workbook_bytes=workbook_bytes, file_format="xls", study_id=study_id
        )

        # Stable mapping assertions for deterministic extraction.
        ae_col = _get_column(summary, dataset_name="AE", column_name="AEACN")
        assert ae_col is not None, f"Missing AE.AEACN in {path.name}"
        assert ae_col.get("column_type") == "categorical"

        visit_col = _get_column(summary, dataset_name="VIST", column_name="VISITDAT")
        assert visit_col is not None, f"Missing VIST.VISITDAT in {path.name}"
        assert visit_col.get("column_type") == "datetime"

        # Downstream contract: dictionary must be schema-valid.
        _validate_field_dictionary_schema(study_id=study_id, summary=summary)


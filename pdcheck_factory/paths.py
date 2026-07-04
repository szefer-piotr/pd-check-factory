"""Blob and local path conventions for the MVP pipeline."""

from pathlib import Path
from typing import List


def raw_protocol_blob(study_id: str) -> str:
    return f"raw/{study_id}/protocol.pdf"


def raw_acrf_blob(study_id: str) -> str:
    return f"raw/{study_id}/acrf.pdf"


def study_blob_list_prefixes(study_id: str) -> List[str]:
    """Blob path prefixes for all artifacts belonging to a study."""
    return [
        f"raw/{study_id}/",
        f"extractions/{study_id}/",
        f"pipeline/{study_id}/",
        f"review/{study_id}/",
    ]


def raw_protocol_reference_blob(study_id: str, safe_filename: str) -> str:
    return f"raw/{study_id}/reference/protocol/{safe_filename}"


def raw_acrf_reference_blob(study_id: str, safe_filename: str) -> str:
    return f"raw/{study_id}/reference/acrf/{safe_filename}"


def ui_upload_manifest_blob(study_id: str) -> str:
    return f"pipeline/{study_id}/ui_upload_manifest.json"


def extraction_layout_prefix(study_id: str, doc_role: str) -> str:
    return f"extractions/{study_id}/{doc_role}/layout"


def protocol_sections_blob_prefix(study_id: str) -> str:
    return f"pipeline/{study_id}/protocol_sections"


def acrf_summary_blob_prefix(study_id: str) -> str:
    return f"pipeline/{study_id}/acrf_summary"


def acrf_summary_sections_blob_prefix(study_id: str) -> str:
    return f"{acrf_summary_blob_prefix(study_id)}/sections"


def acrf_summary_section_blob(study_id: str, acrf_section_id: str) -> str:
    safe = acrf_section_id.replace(":", "_")
    return f"{acrf_summary_sections_blob_prefix(study_id)}/{safe}.json"


def acrf_summary_merged_blob(study_id: str) -> str:
    return f"{acrf_summary_blob_prefix(study_id)}/acrf_summary_merged.json"


def pipeline_step2_blob_prefix(study_id: str) -> str:
    return f"pipeline/{study_id}/step2"


def protocol_sections_manifest_blob(study_id: str) -> str:
    return f"{protocol_sections_blob_prefix(study_id)}/sections_manifest.json"


def protocol_section_step1_blob(study_id: str, section_id: str) -> str:
    safe = section_id.replace(":", "_")
    return f"{protocol_sections_blob_prefix(study_id)}/step1/{safe}.json"


def protocol_sections_step2_merged_blob(study_id: str) -> str:
    return f"{pipeline_step2_blob_prefix(study_id)}/step2_merged.json"


def protocol_sections_step2_review_workbook_blob(study_id: str) -> str:
    return f"{pipeline_step2_blob_prefix(study_id)}/step2_dm_review.xlsx"


def protocol_sections_step2_reviewed_workbook_blob(study_id: str) -> str:
    return f"{pipeline_step2_blob_prefix(study_id)}/step2_dm_review.reviewed.xlsx"


def protocol_sections_step2_validated_blob(study_id: str) -> str:
    return f"{pipeline_step2_blob_prefix(study_id)}/step2_validated.json"


def protocol_sections_step2_validation_audit_blob(study_id: str) -> str:
    return f"{pipeline_step2_blob_prefix(study_id)}/step2_validation_audit.json"


def dm_review_workbook_blob(study_id: str) -> str:
    return f"review/{study_id}/dm_review_roundtrip.xlsx"


def local_study_root(study_id: str, output_dir: Path) -> Path:
    return output_dir / study_id


def local_ui_upload_manifest(study_id: str, output_dir: Path) -> Path:
    return local_study_root(study_id, output_dir) / "ui_upload_manifest.json"


def local_ui_pipeline_run_state(study_id: str, output_dir: Path) -> Path:
    return local_study_root(study_id, output_dir) / "ui_pipeline_run_state.json"


def ui_run_manifest_blob(study_id: str) -> str:
    return f"pipeline/{study_id}/ui_run_manifest.json"


def local_ui_run_manifest(study_id: str, output_dir: Path) -> Path:
    return local_study_root(study_id, output_dir) / "ui_run_manifest.json"


def local_extraction_layout(study_id: str, doc_role: str, output_dir: Path) -> Path:
    return local_study_root(study_id, output_dir) / "extractions" / doc_role / "layout"


def local_extraction_opendataloader(study_id: str, doc_role: str, output_dir: Path) -> Path:
    return (
        local_study_root(study_id, output_dir)
        / "extractions"
        / doc_role
        / "opendataloader"
    )


def local_protocol_sections_dir(study_id: str, output_dir: Path) -> Path:
    return local_study_root(study_id, output_dir) / "pipeline" / "protocol_sections"


def local_acrf_summary_dir(study_id: str, output_dir: Path) -> Path:
    return local_study_root(study_id, output_dir) / "pipeline" / "acrf_summary"


def local_acrf_summary_sections_dir(study_id: str, output_dir: Path) -> Path:
    return local_acrf_summary_dir(study_id, output_dir) / "sections"


def local_acrf_summary_section(study_id: str, acrf_section_id: str, output_dir: Path) -> Path:
    safe = acrf_section_id.replace(":", "_")
    return local_acrf_summary_sections_dir(study_id, output_dir) / f"{safe}.json"


def local_acrf_summary_merged(study_id: str, output_dir: Path) -> Path:
    return local_acrf_summary_dir(study_id, output_dir) / "acrf_summary_merged.json"


def local_pipeline_step2_dir(study_id: str, output_dir: Path) -> Path:
    return local_study_root(study_id, output_dir) / "pipeline" / "step2"


def local_protocol_sections_manifest(study_id: str, output_dir: Path) -> Path:
    return local_protocol_sections_dir(study_id, output_dir) / "sections_manifest.json"


def local_protocol_sections_raw_dir(study_id: str, output_dir: Path) -> Path:
    return local_protocol_sections_dir(study_id, output_dir) / "raw"


def local_protocol_sections_step1_dir(study_id: str, output_dir: Path) -> Path:
    return local_protocol_sections_dir(study_id, output_dir) / "step1"


def local_protocol_sections_step2_merged(study_id: str, output_dir: Path) -> Path:
    return local_pipeline_step2_dir(study_id, output_dir) / "step2_merged.json"


def local_protocol_sections_step2_review_workbook(study_id: str, output_dir: Path) -> Path:
    return local_pipeline_step2_dir(study_id, output_dir) / "step2_dm_review.xlsx"


def local_protocol_sections_step2_reviewed_workbook(
    study_id: str, output_dir: Path
) -> Path:
    return local_pipeline_step2_dir(study_id, output_dir) / "step2_dm_review.reviewed.xlsx"


def local_protocol_sections_step2_validated(study_id: str, output_dir: Path) -> Path:
    return local_pipeline_step2_dir(study_id, output_dir) / "step2_validated.json"


def local_protocol_sections_step2_validation_audit(
    study_id: str, output_dir: Path
) -> Path:
    return local_pipeline_step2_dir(study_id, output_dir) / "step2_validation_audit.json"


def local_dm_review_workbook(study_id: str, output_dir: Path) -> Path:
    return local_study_root(study_id, output_dir) / "review" / "dm_review_roundtrip.xlsx"


def local_pipeline_v2_dir(study_id: str, output_dir: Path) -> Path:
    return local_study_root(study_id, output_dir) / "pipeline"


def local_protocol_index_dir(study_id: str, output_dir: Path) -> Path:
    return local_pipeline_v2_dir(study_id, output_dir) / "protocol_index"


def local_protocol_paragraphs_md(study_id: str, output_dir: Path) -> Path:
    return local_protocol_index_dir(study_id, output_dir) / "full_protocol_paragraphs.md"


def local_protocol_paragraph_index_json(study_id: str, output_dir: Path) -> Path:
    return local_protocol_index_dir(study_id, output_dir) / "paragraph_index.json"


def local_acrf_summary_text_dir(study_id: str, output_dir: Path) -> Path:
    return local_pipeline_v2_dir(study_id, output_dir) / "acrf_summary"


def local_acrf_summary_text_merged(study_id: str, output_dir: Path) -> Path:
    return local_acrf_summary_text_dir(study_id, output_dir) / "acrf_summary_text_merged.json"


def local_rules_dir(study_id: str, output_dir: Path) -> Path:
    return local_pipeline_v2_dir(study_id, output_dir) / "rules"


def local_rules_raw_txt(study_id: str, output_dir: Path) -> Path:
    return local_rules_dir(study_id, output_dir) / "rules_raw.txt"


def local_rules_parsed_json(study_id: str, output_dir: Path) -> Path:
    return local_rules_dir(study_id, output_dir) / "rules_parsed.json"


def local_deviations_dir(study_id: str, output_dir: Path) -> Path:
    return local_pipeline_v2_dir(study_id, output_dir) / "deviations"


def local_deviations_raw_txt(study_id: str, output_dir: Path) -> Path:
    return local_deviations_dir(study_id, output_dir) / "deviations_raw.txt"


def local_deviations_parsed_json(study_id: str, output_dir: Path) -> Path:
    return local_deviations_dir(study_id, output_dir) / "deviations_parsed.json"


def local_review_dir(study_id: str, output_dir: Path) -> Path:
    return local_pipeline_v2_dir(study_id, output_dir) / "review"


def local_deviations_review_state(study_id: str, output_dir: Path) -> Path:
    return local_review_dir(study_id, output_dir) / "deviations_review_state.json"


def local_deviations_review_generated_json(study_id: str, output_dir: Path) -> Path:
    return local_review_dir(study_id, output_dir) / "deviations_review_generated.json"


def local_deviations_review_imported_pd_spec_json(study_id: str, output_dir: Path) -> Path:
    return local_review_dir(study_id, output_dir) / "deviations_review_imported_pd_spec.json"


def local_deviations_review_enriched_pd_spec_json(study_id: str, output_dir: Path) -> Path:
    return local_review_dir(study_id, output_dir) / "deviations_review_enriched_pd_spec.json"


def local_deviations_validated_json(study_id: str, output_dir: Path) -> Path:
    return local_review_dir(study_id, output_dir) / "deviations_validated.json"


def local_deviations_review_audit_json(study_id: str, output_dir: Path) -> Path:
    return local_review_dir(study_id, output_dir) / "deviations_review_audit.json"


def local_deviations_review_export_xlsx(study_id: str, output_dir: Path) -> Path:
    return local_review_dir(study_id, output_dir) / "deviations_review_export.xlsx"


def local_deviations_coding_export_xlsx(study_id: str, output_dir: Path) -> Path:
    return local_review_dir(study_id, output_dir) / "deviations_coding_export.xlsx"


def local_deviation_classification_audit_json(study_id: str, output_dir: Path) -> Path:
    return local_review_dir(study_id, output_dir) / "deviation_classification_audit.json"


def local_deviation_consolidation_audit_json(study_id: str, output_dir: Path) -> Path:
    return local_review_dir(study_id, output_dir) / "deviation_consolidation_audit.json"


def local_model_output_log_json(study_id: str, output_dir: Path) -> Path:
    return local_review_dir(study_id, output_dir) / "model_output_log.json"


def local_pseudo_logic_dir(study_id: str, output_dir: Path) -> Path:
    return local_pipeline_v2_dir(study_id, output_dir) / "pseudo_logic"


def local_pseudo_logic_raw_txt(study_id: str, output_dir: Path) -> Path:
    return local_pseudo_logic_dir(study_id, output_dir) / "pseudo_logic_raw.txt"


def local_pseudo_logic_validated_json(study_id: str, output_dir: Path) -> Path:
    return local_pseudo_logic_dir(study_id, output_dir) / "pseudo_logic_validated.json"


def local_pseudo_logic_review_state(study_id: str, output_dir: Path) -> Path:
    return local_review_dir(study_id, output_dir) / "pseudo_logic_review_state.json"


def local_pseudo_logic_review_audit_json(study_id: str, output_dir: Path) -> Path:
    return local_review_dir(study_id, output_dir) / "pseudo_logic_review_audit.json"


def local_final_dir(study_id: str, output_dir: Path) -> Path:
    return local_pipeline_v2_dir(study_id, output_dir) / "final"


def local_final_deviations_json(study_id: str, output_dir: Path) -> Path:
    return local_final_dir(study_id, output_dir) / "final_deviations.json"


def local_final_deviations_xlsx(study_id: str, output_dir: Path) -> Path:
    return local_final_dir(study_id, output_dir) / "final_deviations.xlsx"


def local_imports_dir(study_id: str, output_dir: Path) -> Path:
    return local_pipeline_v2_dir(study_id, output_dir) / "imports"


def local_pd_spec_workbook(study_id: str, output_dir: Path) -> Path:
    return local_imports_dir(study_id, output_dir) / "pd_specifications.xlsx"


def pd_spec_workbook_blob(study_id: str) -> str:
    """Blob path mirrored from ``local_pd_spec_workbook``."""
    return f"pipeline/{study_id}/imports/pd_specifications.xlsx"


def local_deviations_import_snapshot(study_id: str, output_dir: Path, version: str) -> Path:
    safe = version.replace("/", "_").replace("\\", "_")
    return local_review_dir(study_id, output_dir) / f"deviations_import_{safe}.json"


def local_deviations_merged_snapshot(study_id: str, output_dir: Path, version: str) -> Path:
    safe = version.replace("/", "_").replace("\\", "_")
    return local_review_dir(study_id, output_dir) / f"deviations_merged_{safe}.json"


def local_deviation_context_dir(study_id: str, output_dir: Path) -> Path:
    return local_pipeline_v2_dir(study_id, output_dir) / "coding" / "deviation_context"


def local_deviation_context_json(study_id: str, output_dir: Path, deviation_id: str) -> Path:
    safe = deviation_id.replace("/", "_").replace("\\", "_")
    return local_deviation_context_dir(study_id, output_dir) / f"{safe}.json"


def local_protocol_enrichment_dir(study_id: str, output_dir: Path) -> Path:
    return local_pipeline_v2_dir(study_id, output_dir) / "coding" / "protocol_enrichment"


def local_protocol_enrichment_json(study_id: str, output_dir: Path, deviation_id: str) -> Path:
    safe = deviation_id.replace("/", "_").replace("\\", "_")
    return local_protocol_enrichment_dir(study_id, output_dir) / f"{safe}.json"

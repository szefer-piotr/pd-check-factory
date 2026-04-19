"""Blob and local path conventions for the MVP pipeline."""

from pathlib import Path


def raw_protocol_blob(study_id: str) -> str:
    return f"raw/{study_id}/protocol.pdf"


def raw_acrf_blob(study_id: str) -> str:
    return f"raw/{study_id}/acrf.pdf"


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


def local_extraction_layout(study_id: str, doc_role: str, output_dir: Path) -> Path:
    return local_study_root(study_id, output_dir) / "extractions" / doc_role / "layout"


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

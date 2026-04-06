"""Blob and local path conventions for the MVP pipeline."""

from pathlib import Path


def raw_protocol_blob(study_id: str) -> str:
    return f"raw/{study_id}/protocol.pdf"


def raw_acrf_blob(study_id: str) -> str:
    return f"raw/{study_id}/acrf.pdf"


def extraction_layout_prefix(study_id: str, doc_role: str) -> str:
    return f"extractions/{study_id}/{doc_role}/layout"


def pipeline_rules_kb_blob(study_id: str) -> str:
    return f"pipeline/{study_id}/protocol_rules_kb.json"


def pipeline_pd_dir_blob(study_id: str) -> str:
    return f"pipeline/{study_id}/pd"


def candidates_blob(study_id: str) -> str:
    return f"{pipeline_pd_dir_blob(study_id)}/candidates.json"


def logic_drafts_blob(study_id: str) -> str:
    return f"{pipeline_pd_dir_blob(study_id)}/logic_drafts.json"


def pd_draft_specs_blob(study_id: str) -> str:
    return f"{pipeline_pd_dir_blob(study_id)}/pd_draft_specs.json"


def dm_review_workbook_blob(study_id: str) -> str:
    return f"review/{study_id}/dm_review_roundtrip.xlsx"


def pseudo_bundle_blob(study_id: str) -> str:
    return f"artifacts/{study_id}/pseudo_logic_bundle.json"


def local_study_root(study_id: str, output_dir: Path) -> Path:
    return output_dir / study_id


def local_extraction_layout(study_id: str, doc_role: str, output_dir: Path) -> Path:
    return local_study_root(study_id, output_dir) / "extractions" / doc_role / "layout"


def local_pipeline_rules_kb(study_id: str, output_dir: Path) -> Path:
    return local_study_root(study_id, output_dir) / "pipeline" / "protocol_rules_kb.json"


def local_pipeline_pd_dir(study_id: str, output_dir: Path) -> Path:
    return local_study_root(study_id, output_dir) / "pipeline" / "pd"


def local_dm_review_workbook(study_id: str, output_dir: Path) -> Path:
    return local_study_root(study_id, output_dir) / "review" / "dm_review_roundtrip.xlsx"


def local_pseudo_bundle(study_id: str, output_dir: Path) -> Path:
    return local_study_root(study_id, output_dir) / "artifacts" / "pseudo_logic_bundle.json"

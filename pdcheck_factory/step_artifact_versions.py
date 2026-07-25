"""Versioned snapshots for LLM pipeline step outputs."""

from __future__ import annotations

import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Tuple

from pdcheck_factory import paths, study_artifact_sync
from pdcheck_factory.json_util import read_json, write_json

VERSIONED_STEP_IDS = ("acrf-summary-text", "extract-rules", "extract-deviations")

StepFileSpec = Tuple[str, Callable[[str, Path], Path]]

_STEP_FILE_SPECS: Dict[str, List[StepFileSpec]] = {
    "acrf-summary-text": [
        ("acrf_summary_text_merged.json", paths.local_acrf_summary_text_merged),
    ],
    "extract-rules": [
        ("rules_parsed.json", paths.local_rules_parsed_json),
    ],
    "extract-deviations": [
        ("deviations_parsed.json", paths.local_deviations_parsed_json),
        ("deviations_review_state.json", paths.local_deviations_review_state),
    ],
}

_PRIMARY_ARTIFACT: Dict[str, str] = {
    "acrf-summary-text": "acrf_summary_text_merged.json",
    "extract-rules": "rules_parsed.json",
    "extract-deviations": "deviations_parsed.json",
}


def is_versioned_step(step_id: str) -> bool:
    return step_id in VERSIONED_STEP_IDS


def _versions_root(study_id: str, output_dir: Path, step_id: str) -> Path:
    return paths.local_pipeline_v2_dir(study_id, output_dir) / "versions" / step_id


def _version_dir(study_id: str, output_dir: Path, step_id: str, version: str) -> Path:
    return _versions_root(study_id, output_dir, step_id) / version


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _step_file_specs(step_id: str) -> List[StepFileSpec]:
    specs = _STEP_FILE_SPECS.get(step_id)
    if not specs:
        raise ValueError(f"Step '{step_id}' is not versioned")
    return specs


def _canonical_files_exist(study_id: str, output_dir: Path, step_id: str) -> bool:
    specs = _step_file_specs(step_id)
    primary_name = _PRIMARY_ARTIFACT[step_id]
    for file_name, path_fn in specs:
        if file_name == primary_name:
            return path_fn(study_id, output_dir).is_file()
    return False


def _next_version(study_id: str, output_dir: Path, step_id: str) -> str:
    root = _versions_root(study_id, output_dir, step_id)
    existing = sorted(p.name for p in root.glob("v*") if p.is_dir()) if root.is_dir() else []
    return f"v{len(existing) + 1}"


def _read_version_manifest(version_dir: Path) -> Dict[str, Any]:
    manifest_path = version_dir / "manifest.json"
    if manifest_path.is_file():
        try:
            obj = read_json(manifest_path)
            if isinstance(obj, dict):
                return obj
        except (json.JSONDecodeError, OSError, ValueError, TypeError):
            pass
    return {}


def _artifact_metadata(study_id: str, output_dir: Path, step_id: str, version_dir: Path) -> Dict[str, Any]:
    primary_name = _PRIMARY_ARTIFACT[step_id]
    primary_path = version_dir / primary_name
    generated_at = ""
    item_count = 0
    if primary_path.is_file():
        try:
            obj = read_json(primary_path)
            generated_at = str(obj.get("generated_at") or "")
            if step_id == "extract-rules":
                item_count = len(obj.get("rules", []))
            elif step_id == "extract-deviations":
                item_count = len(obj.get("deviations", []))
            elif step_id == "acrf-summary-text":
                item_count = len(obj.get("datasets", []))
        except (json.JSONDecodeError, OSError, ValueError, TypeError):
            pass
    manifest = _read_version_manifest(version_dir)
    return {
        "version": version_dir.name,
        "created_at": str(manifest.get("created_at") or ""),
        "generated_at": generated_at,
        "itemCount": item_count,
    }


def register_version_after_run(study_id: str, output_dir: Path, step_id: str) -> str:
    """Copy canonical artifacts into a new version folder. Returns version label."""
    if not is_versioned_step(step_id):
        raise ValueError(f"Step '{step_id}' is not versioned")
    if not _canonical_files_exist(study_id, output_dir, step_id):
        raise ValueError(f"No canonical artifacts to version for step '{step_id}'")

    version = _next_version(study_id, output_dir, step_id)
    version_dir = _version_dir(study_id, output_dir, step_id, version)
    version_dir.mkdir(parents=True, exist_ok=True)

    copied_files: List[str] = []
    for file_name, path_fn in _step_file_specs(step_id):
        src = path_fn(study_id, output_dir)
        if src.is_file():
            dest = version_dir / file_name
            shutil.copy2(src, dest)
            copied_files.append(file_name)

    manifest = {
        "version": version,
        "created_at": _iso_now(),
        "stepId": step_id,
        "files": copied_files,
    }
    write_json(version_dir / "manifest.json", manifest)
    study_artifact_sync.mirror_upload_directory(study_id, output_dir, version_dir)
    return version


def list_step_versions(
    study_id: str,
    output_dir: Path,
    step_id: str,
    *,
    active_version: str | None = None,
) -> Dict[str, Any]:
    if not is_versioned_step(step_id):
        raise ValueError(f"Step '{step_id}' is not versioned")

    root = _versions_root(study_id, output_dir, step_id)
    versions: List[Dict[str, Any]] = []
    if root.is_dir():
        for version_dir in sorted(root.iterdir(), key=lambda p: p.name):
            if not version_dir.is_dir() or not version_dir.name.startswith("v"):
                continue
            meta = _artifact_metadata(study_id, output_dir, step_id, version_dir)
            meta["active"] = active_version == version_dir.name if active_version else False
            versions.append(meta)

    return {
        "stepId": step_id,
        "activeVersion": active_version,
        "versions": versions,
    }


def list_all_step_versions(
    study_id: str,
    output_dir: Path,
    active_step_artifacts: Dict[str, Any] | None,
) -> Dict[str, Any]:
    active_map = active_step_artifacts if isinstance(active_step_artifacts, dict) else {}
    out: Dict[str, Any] = {}
    for step_id in VERSIONED_STEP_IDS:
        active_version = str(active_map.get(step_id) or "").strip() or None
        out[step_id] = list_step_versions(study_id, output_dir, step_id, active_version=active_version)
    return out


def apply_active_step_artifact(
    study_id: str,
    output_dir: Path,
    step_id: str,
    version: str,
) -> Dict[str, Any]:
    if not is_versioned_step(step_id):
        raise ValueError(f"Step '{step_id}' is not versioned")
    version_label = (version or "").strip()
    if not version_label:
        raise ValueError("version is required")

    version_dir = _version_dir(study_id, output_dir, step_id, version_label)
    if not version_dir.is_dir():
        raise ValueError(f"Version '{version_label}' not found for step '{step_id}'")

    manifest = _read_version_manifest(version_dir)
    file_names = list(manifest.get("files") or [])
    if not file_names:
        file_names = [name for name, _ in _step_file_specs(step_id)]

    spec_by_name = {name: path_fn for name, path_fn in _step_file_specs(step_id)}
    for file_name in file_names:
        src = version_dir / file_name
        path_fn = spec_by_name.get(file_name)
        if path_fn is None or not src.is_file():
            continue
        dest = path_fn(study_id, output_dir)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
        study_artifact_sync.mirror_upload_path(study_id, output_dir, dest)

    meta = _artifact_metadata(study_id, output_dir, step_id, version_dir)
    return {
        "stepId": step_id,
        "version": version_label,
        "itemCount": meta.get("itemCount", 0),
    }


def artifact_metadata(study_id: str, output_dir: Path, step_id: str, version_dir: Path) -> Dict[str, Any]:
    return _artifact_metadata(study_id, output_dir, step_id, version_dir)


def version_artifact_path(
    study_id: str,
    output_dir: Path,
    step_id: str,
    version: str,
    file_name: str,
) -> Path:
    return _version_dir(study_id, output_dir, step_id, version.strip()) / file_name


def resolve_preview_path(
    study_id: str,
    output_dir: Path,
    step_id: str,
    canonical_path: Path,
    *,
    version: str | None = None,
) -> Path:
    """Return path to artifact for preview — version snapshot or canonical."""
    if not version or not is_versioned_step(step_id):
        return canonical_path
    version_label = version.strip()
    if not version_label:
        return canonical_path
    primary_name = _PRIMARY_ARTIFACT.get(step_id)
    if not primary_name:
        return canonical_path
    version_file = _version_dir(study_id, output_dir, step_id, version_label) / primary_name
    if version_file.is_file():
        return version_file
    return canonical_path

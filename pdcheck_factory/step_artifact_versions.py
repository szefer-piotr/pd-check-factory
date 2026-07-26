"""Versioned snapshots for LLM pipeline step outputs."""

from __future__ import annotations

import hashlib
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
        ("deviations_review_generated.json", paths.local_deviations_review_generated_json),
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


def _file_fingerprint(path: Path) -> Dict[str, Any]:
    """Content fingerprint for non-versioned upstream artifacts."""
    if not path.is_file():
        return {"generated_at": "", "sha256": "", "exists": False}
    data = path.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    generated_at = ""
    paragraph_count: int | None = None
    try:
        obj = json.loads(data.decode("utf-8"))
        if isinstance(obj, dict):
            generated_at = str(obj.get("generated_at") or "")
            if isinstance(obj.get("paragraphs"), list):
                paragraph_count = len(obj["paragraphs"])
    except (UnicodeDecodeError, json.JSONDecodeError, TypeError, ValueError):
        pass
    out: Dict[str, Any] = {
        "generated_at": generated_at,
        "sha256": digest,
        "exists": True,
    }
    if paragraph_count is not None:
        out["paragraph_count"] = paragraph_count
    return out


def resolve_deviation_source_versions(
    study_id: str,
    output_dir: Path,
    active_step_artifacts: Dict[str, Any] | None,
) -> Dict[str, Any]:
    """Resolve upstream sources used to generate deviations."""
    active_map = active_step_artifacts if isinstance(active_step_artifacts, dict) else {}
    acrf_version = str(active_map.get("acrf-summary-text") or "").strip()
    rules_version = str(active_map.get("extract-rules") or "").strip()
    return {
        "acrf-summary-text": acrf_version or None,
        "extract-rules": rules_version or None,
        "acrf-field-dictionary": _file_fingerprint(
            paths.local_acrf_field_dictionary_json(study_id, output_dir)
        ),
        "protocol-index": _file_fingerprint(
            paths.local_protocol_paragraph_index_json(study_id, output_dir)
        ),
    }


def source_versions_equal(a: Any, b: Any) -> bool:
    """Deep equality for sourceVersions objects (JSON-normalized)."""
    try:
        return json.dumps(a, sort_keys=True, default=str) == json.dumps(b, sort_keys=True, default=str)
    except (TypeError, ValueError):
        return False


def _source_summary(source_versions: Dict[str, Any] | None) -> str:
    if not isinstance(source_versions, dict) or not source_versions:
        return ""
    parts: List[str] = []
    rules = source_versions.get("extract-rules")
    if rules:
        parts.append(f"rules {rules}")
    acrf = source_versions.get("acrf-summary-text")
    if acrf:
        parts.append(f"aCRF {acrf}")
    return " · ".join(parts)


def find_versions_with_same_sources(
    study_id: str,
    output_dir: Path,
    step_id: str,
    source_versions: Dict[str, Any],
) -> List[str]:
    root = _versions_root(study_id, output_dir, step_id)
    matches: List[str] = []
    if not root.is_dir():
        return matches
    for version_dir in sorted(root.iterdir(), key=lambda p: p.name):
        if not version_dir.is_dir() or not version_dir.name.startswith("v"):
            continue
        manifest = _read_version_manifest(version_dir)
        if source_versions_equal(manifest.get("sourceVersions"), source_versions):
            matches.append(version_dir.name)
    return matches


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
    source_versions = manifest.get("sourceVersions")
    derived_from = manifest.get("derivedFrom")
    meta: Dict[str, Any] = {
        "version": version_dir.name,
        "created_at": str(manifest.get("created_at") or ""),
        "generated_at": generated_at,
        "itemCount": item_count,
    }
    if isinstance(source_versions, dict):
        meta["sourceVersions"] = source_versions
        summary = _source_summary(source_versions)
        if summary:
            meta["sourceSummary"] = summary
    if isinstance(derived_from, dict) and derived_from:
        meta["derivedFrom"] = derived_from
    return meta


def _copy_canonical_to_version_dir(
    study_id: str,
    output_dir: Path,
    step_id: str,
    version_dir: Path,
) -> List[str]:
    version_dir.mkdir(parents=True, exist_ok=True)
    copied_files: List[str] = []
    for file_name, path_fn in _step_file_specs(step_id):
        src = path_fn(study_id, output_dir)
        if src.is_file():
            dest = version_dir / file_name
            shutil.copy2(src, dest)
            copied_files.append(file_name)
    return copied_files


def register_version_after_run(
    study_id: str,
    output_dir: Path,
    step_id: str,
    *,
    source_versions: Dict[str, Any] | None = None,
    derived_from: Dict[str, Any] | None = None,
    version_mode: str = "new",
    overwrite_version: str | None = None,
) -> str:
    """Copy canonical artifacts into a version folder. Returns version label."""
    if not is_versioned_step(step_id):
        raise ValueError(f"Step '{step_id}' is not versioned")
    if not _canonical_files_exist(study_id, output_dir, step_id):
        raise ValueError(f"No canonical artifacts to version for step '{step_id}'")

    mode = (version_mode or "new").strip().lower()
    if mode not in {"new", "overwrite"}:
        raise ValueError(f"Invalid version_mode '{version_mode}'")

    if mode == "overwrite":
        version = (overwrite_version or "").strip()
        if not version:
            raise ValueError("overwrite_version is required when version_mode is overwrite")
        version_dir = _version_dir(study_id, output_dir, step_id, version)
        if not version_dir.is_dir():
            raise ValueError(f"Version '{version}' not found for step '{step_id}'")
        if source_versions is not None:
            existing = _read_version_manifest(version_dir)
            existing_sources = existing.get("sourceVersions")
            if existing_sources is not None and not source_versions_equal(existing_sources, source_versions):
                raise ValueError(
                    f"Cannot overwrite version '{version}': sourceVersions do not match current sources"
                )
        # Clear prior snapshot files so removed artifacts don't linger.
        for child in list(version_dir.iterdir()):
            if child.is_file():
                child.unlink()
    else:
        version = _next_version(study_id, output_dir, step_id)
        version_dir = _version_dir(study_id, output_dir, step_id, version)

    copied_files = _copy_canonical_to_version_dir(study_id, output_dir, step_id, version_dir)

    manifest: Dict[str, Any] = {
        "version": version,
        "created_at": _iso_now(),
        "stepId": step_id,
        "files": copied_files,
    }
    if source_versions is not None:
        manifest["sourceVersions"] = source_versions
    if mode == "overwrite":
        # Fresh extract for those sources; clear any prior derivedFrom.
        pass
    elif isinstance(derived_from, dict) and derived_from:
        manifest["derivedFrom"] = derived_from

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

    # When restoring extract-deviations, also ensure validated mirrors review state if present.
    if step_id == "extract-deviations":
        review_path = paths.local_deviations_review_state(study_id, output_dir)
        validated_path = paths.local_deviations_validated_json(study_id, output_dir)
        if review_path.is_file():
            validated_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(review_path, validated_path)
            study_artifact_sync.mirror_upload_path(study_id, output_dir, validated_path)

    meta = _artifact_metadata(study_id, output_dir, step_id, version_dir)
    return {
        "stepId": step_id,
        "version": version_label,
        "itemCount": meta.get("itemCount", 0),
        "sourceVersions": meta.get("sourceVersions"),
        "derivedFrom": meta.get("derivedFrom"),
    }


def get_version_manifest(
    study_id: str,
    output_dir: Path,
    step_id: str,
    version: str,
) -> Dict[str, Any]:
    version_dir = _version_dir(study_id, output_dir, step_id, version.strip())
    return _read_version_manifest(version_dir)


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

"""
Analyze a protocol PDF with Document Intelligence Layout (legacy entrypoint).

Prefer: `pdcheck extract --study-id ...` from the pdcheck_factory CLI.
This script delegates to the shared library and uses doc_role `protocol`.
"""

import argparse
import os
from pathlib import Path

from dotenv import load_dotenv

from pdcheck_factory import blob_io, di_layout, paths


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Analyze a protocol PDF with DI Layout and persist artifacts."
    )
    parser.add_argument("--study-id", default=None, help="Overrides STUDY_ID.")
    parser.add_argument(
        "--blob-path",
        default=None,
        help="Overrides BLOB_PATH (blob path inside the storage container).",
    )
    parser.add_argument(
        "--model-id",
        default=os.getenv("DI_MODEL_ID", "prebuilt-layout"),
        help='DI model id (default: "prebuilt-layout").',
    )
    parser.add_argument(
        "--sas-ttl-minutes",
        type=int,
        default=int(os.getenv("DI_SAS_TTL_MINUTES", "15")),
        help="SAS TTL minutes (default: 15).",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("output"),
        help="Local output directory root (default: output).",
    )
    args = parser.parse_args()

    load_dotenv()

    study_id = args.study_id or os.getenv("STUDY_ID")
    if not study_id:
        raise ValueError("Missing required configuration: STUDY_ID.")

    blob_path = args.blob_path or os.getenv("BLOB_PATH") or os.getenv("PDF_PATH")
    if not blob_path:
        raise ValueError("Missing required configuration: BLOB_PATH (or PDF_PATH).")

    storage_connection_string = os.getenv("STORAGE_CONNECTION_STRING")
    container_name = os.getenv("STORAGE_CONTAINER")
    if not storage_connection_string or not container_name:
        raise ValueError(
            "Missing required Blob Storage configuration: "
            "`STORAGE_CONNECTION_STRING` and `STORAGE_CONTAINER`."
        )

    di_endpoint = blob_io.require_env("DI_ENDPOINT")
    di_key = blob_io.require_env("DI_KEY")

    blob_service = blob_io.blob_service_from_env()
    local_base = paths.local_extraction_layout(study_id, "protocol", args.output_dir)

    di_layout.run_layout_for_blob(
        study_id=study_id,
        doc_role="protocol",
        source_blob_path=blob_path,
        local_layout_base=local_base,
        blob_service=blob_service,
        container_name=container_name,
        storage_connection_string=storage_connection_string,
        di_endpoint=di_endpoint,
        di_key=di_key,
        model_id=args.model_id,
        sas_ttl_minutes=args.sas_ttl_minutes,
        upload_to_blob=True,
    )


if __name__ == "__main__":
    main()

# Storage layout (ADLS Gen2)

The PD Check Factory uses a single Azure Data Lake Storage Gen2 account (StorageV2 with hierarchical namespace enabled). Containers and virtual folders are organized as follows.

## Containers and folder layout

Folders are virtual: they appear when blobs are written with a path prefix (e.g. `protocol/myfile.pdf`). No Bicep or API call is required to "create" a folder.

| Container | Purpose | Virtual folders / usage |
|-----------|---------|--------------------------|
| **raw** | Ingested source documents (PDFs, etc.) | `protocol/` — protocol documents<br>`crf/` — CRF specifications<br>`specs/` — DM / other specs |
| **extracted** | Output from Document Intelligence | `edc_extracts/` — EDC-specific extractions; other extraction types can use root or additional prefixes |
| **catalogs** | PD check catalogs (drafts and approved) | Use study-specific prefixes, e.g. `{study_id}/catalog.json` |
| **outputs** | Pipeline outputs, exports, generated artifacts | Any path; e.g. `{study_id}/export/` |
| **audit** | Audit logs and operational records | Any path; e.g. `uploads/`, `approvals/` |

## Naming

- Storage account name follows [infra/env/dev.yaml](../infra/env/dev.yaml) (e.g. `stpdchkdevweu01`).
- Use lowercase and forward slashes for paths; avoid spaces and special characters in blob names.

## Access

Access to storage is via **Managed Identity** (Function App and Web App). See [ACCESS_MODEL.md](ACCESS_MODEL.md) for roles and principals. For local development, use `STORAGE_ACCOUNT_NAME` and `STORAGE_ACCOUNT_KEY` in environment or Key Vault.

## Enabling hierarchical namespace (ADLS Gen2)

The storage account is created with `isHnsEnabled: true` in [infra/bicep/storage.bicep](../infra/bicep/storage.bicep). Enabling hierarchical namespace is **one-way and irreversible**. If you already have an existing storage account without HNS, you must create a new account and migrate data; do not try to enable HNS on that existing account.

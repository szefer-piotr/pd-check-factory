# Access model

This document describes how Azure resources in PD Check Factory access storage and secrets: which identities are used, which roles they have, and how to replicate the model for new apps or local development.

## Principals

| Principal | Type | Purpose |
|-----------|------|---------|
| **Function App** (`func-pdchk-{env}-{region}`) | System-assigned Managed Identity | Runs ingest and generator Azure Functions; reads/writes blobs, reads Key Vault secrets. |
| **Web App** (`app-pdchk-{env}-{region}`) | System-assigned Managed Identity | Runs Streamlit reviewer UI; reads blobs, reads Key Vault secrets. |

Both identities are created and enabled by Bicep ([infra/bicep/functions.bicep](../infra/bicep/functions.bicep), [infra/bicep/webapp.bicep](../infra/bicep/webapp.bicep)). No storage account key or Key Vault secrets are stored in app settings for these apps when deployed to Azure.

## Roles

### Data storage account (ADLS Gen2)

- **Storage Blob Data Contributor** is assigned to:
  - Function App Managed Identity
  - Web App Managed Identity  

This allows read and write on all containers and blobs in the single data storage account (containers: `raw`, `extracted`, `catalogs`, `outputs`, `audit`). The Function App’s own runtime storage (AzureWebJobsStorage) is a separate storage account and is not part of this model.

### Key Vault

- **Key Vault Secrets User** is assigned to:
  - Function App Managed Identity
  - Web App Managed Identity  

This allows reading secret values. It does not allow modifying or deleting secrets; use a more privileged role or Key Vault access policies if you need that.

### Where roles are defined

Role assignments are created in [infra/bicep/main.bicep](../infra/bicep/main.bicep) after the storage and key vault modules, using the built-in role definition IDs and the principal IDs output by the Function App and Web App modules.

## Application code

- **Storage**: The shared [shared/python/blob_client.py](../shared/python/blob_client.py) builds a `BlobServiceClient` from a connection string when `STORAGE_ACCOUNT_KEY` (or Key Vault secret `storage-account-key`) is set; otherwise it uses `DefaultAzureCredential()` with the storage account URL (Managed Identity in Azure, or Azure CLI/Visual Studio credentials locally).
- **Key Vault**: [shared/python/config.py](../shared/python/config.py) uses `DefaultAzureCredential()` for Key Vault when loading secrets. In Azure, that resolves to the app’s Managed Identity when no key is configured.

## Adding a new app or identity

1. Create the app (e.g. another Function App or App Service) in Bicep with `identity: { type: 'SystemAssigned' }`.
2. Output the app’s `identity.principalId`.
3. In `main.bicep`, add `Microsoft.Authorization/roleAssignments` resources:
   - Scope: the data storage account (existing reference) or Key Vault (existing reference).
   - `principalId`: the new app’s principal ID.
   - `roleDefinitionId`: same as for Function/Web App (Storage Blob Data Contributor and/or Key Vault Secrets User as needed).
4. Ensure the app has `STORAGE_ACCOUNT_NAME` and `KEY_VAULT_NAME` in app settings (no key). Use the same shared config/blob client so it uses Managed Identity when the key is absent.

## Local development

- **Option A (key in environment)**  
  Set `STORAGE_ACCOUNT_NAME` and `STORAGE_ACCOUNT_KEY` (and optionally `KEY_VAULT_NAME`) in `.env` or `local.settings.json`. The blob client will use the connection string; Key Vault will use `DefaultAzureCredential` (e.g. Azure CLI login).

- **Option B (Key Vault only)**  
  Set `STORAGE_ACCOUNT_NAME` and `KEY_VAULT_NAME`. Store the storage account key in Key Vault as secret `storage-account-key`. Ensure your local identity (e.g. Azure CLI) has **Key Vault Secrets User** (or **Get** on secrets) on the vault. The app will load the key from Key Vault and use the connection string for storage.

- **Option C (no key, dev only)**  
  If you use a local emulator or a dev storage account where your user identity has access, you can leave `STORAGE_ACCOUNT_KEY` unset and rely on `DefaultAzureCredential()` (e.g. Azure CLI) to access the dev storage account. Grant your user **Storage Blob Data Contributor** on that account.

Do not commit `STORAGE_ACCOUNT_KEY` or any secrets to the repo; use `.env` (gitignored) or Key Vault.

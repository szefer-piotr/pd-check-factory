# Usage Guide

## Workflow Overview

1. **Upload Documents** → PDFs to blob storage
2. **Automatic Extraction** → Document Intelligence processes PDFs
3. **Generate Catalog** → Call API to create PD Check Catalog
4. **Review & Approve** → Use Streamlit UI to review checks
5. **Export** → Download approved catalog

## Step-by-Step

### 1. Upload Documents

Upload PDF files to the appropriate blob container:

**Protocol Documents:**
```bash
az storage blob upload \
  --account-name <storage-account> \
  --container-name raw \
  --name protocol/study_protocol_v1.2.pdf \
  --file protocol.pdf
```

**CRF Documents:**
```bash
az storage blob upload \
  --account-name <storage-account> \
  --container-name raw \
  --name crf/crf_specification.pdf \
  --file crf.pdf
```

**DM Specs (optional):**
```bash
az storage blob upload \
  --account-name <storage-account> \
  --container-name raw \
  --name specs/dm_specs.pdf \
  --file specs.pdf
```

### 2. Monitor Extraction

The Event Grid trigger automatically processes uploaded PDFs. Check extraction status:

```bash
# List extracted documents
az storage blob list \
  --account-name <storage-account> \
  --container-name extracted \
  --output table
```

View extraction logs in Application Insights or Function App logs.

### 3. Generate Catalog

Call the generator API endpoint:

```bash
curl -X POST \
  "https://<function-app>.azurewebsites.net/api/generate_catalog?code=<function-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "study_id": "DEMO-001",
    "doc_types": ["protocol", "crf"],
    "version": 1
  }'
```

**Response:**
```json
{
  "success": true,
  "study_id": "DEMO-001",
  "version": 1,
  "catalog_path": "DEMO-001/catalog_v1.json",
  "checks_count": 8,
  "validation_errors": []
}
```

### 4. Review in Streamlit UI

1. Navigate to the App Service URL
2. Select study and version from sidebar
3. Review each check:
   - View protocol references
   - Check input requirements
   - Review logic definition
4. Take actions:
   - **Approve**: Mark check as approved
   - **Reject**: Mark check as rejected
   - **Needs Revision**: Request changes
   - **Edit**: Modify check details
5. Use bulk actions:
   - Approve all pending
   - Export approved catalog
   - Create new version

### 5. Export Approved Catalog

In the Streamlit UI:
1. Click "Export Approved Catalog"
2. Download the JSON file
3. Use for R code generation (future phase)

## API Reference

### Generate Catalog

**Endpoint:** `POST /api/generate_catalog`

**Request:**
```json
{
  "study_id": "string (required)",
  "doc_types": ["protocol", "crf", "specs"] (optional),
  "version": 1 (optional, auto-increments)
}
```

**Response:**
```json
{
  "success": true,
  "study_id": "string",
  "version": 1,
  "catalog_path": "string",
  "checks_count": 8,
  "validation_errors": []
}
```

### Validate Catalog

**Endpoint:** `POST /api/validate_catalog`

**Request:**
```json
{
  "study_id": "string (required)",
  "version": 1 (optional, defaults to 1)
}
```

**Response:**
```json
{
  "valid": true,
  "errors": [],
  "study_id": "string",
  "version": 1
}
```

## Catalog Structure

A PD Check Catalog contains:

- **Metadata**: Study ID, version, creation date, status
- **Checks**: Array of PD check definitions
  - Check ID (CHK001, CHK002, etc.)
  - Name and category
  - Severity level
  - Protocol references
  - Input datasets and columns
  - Logic definition
  - Output message template
  - DM review status

## Best Practices

1. **Document Organization**: Use consistent naming for uploaded PDFs
2. **Version Control**: Always specify versions when generating catalogs
3. **Review Thoroughly**: Check protocol references and logic before approving
4. **Comments**: Add DM comments to explain decisions
5. **Export Regularly**: Download approved catalogs for backup

## Troubleshooting

### Extraction Not Triggering

- Verify PDF is in `raw/` container with correct path
- Check Event Grid subscription is active
- Review Function App logs

### Catalog Generation Fails

- Ensure extracted documents exist
- Check OpenAI deployment is active
- Verify prompt length (may need to chunk large documents)

### UI Not Loading Catalogs

- Verify storage account connection
- Check blob paths match expected format
- Review browser console for errors

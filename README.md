# PD Check Factory

A system for automatically generating Protocol Deviation (PD) Check Catalogs from clinical trial documents using Azure AI services.

## Architecture

The system processes PDF documents through the following pipeline:

1. **Document Upload** → PDFs uploaded to Azure Blob Storage (`raw/` container)
2. **Document Intelligence** → Azure Function extracts text, tables, and structure
3. **Catalog Generation** → Azure OpenAI generates PD Check Catalog from extracted content
4. **Review & Approval** → Streamlit UI for DM review and approval

## Components

### Infrastructure (`infra/bicep/`)
- Bicep templates for Azure resources
- Storage Account with blob containers
- Azure Functions (Event Grid + HTTP triggers)
- Document Intelligence and Azure OpenAI
- App Service for Streamlit

### Services

#### `services/ingest_func/`
- Event Grid triggered Azure Function
- Processes PDF uploads with Document Intelligence
- Saves extracted JSON to `extracted/` container

#### `services/generator_api/`
- HTTP triggered Azure Function
- Generates PD Check Catalogs using Azure OpenAI
- Validates catalogs against JSON schema

#### `services/reviewer_ui/`
- Streamlit web application
- Review, approve, reject, and edit checks
- Export approved catalogs

### Shared (`shared/python/`)
- Pydantic models for schemas
- Blob Storage client wrapper
- Configuration loader

### Schemas (`schemas/`)
- JSON schemas for validation
- Extracted document schema
- PD Check Catalog schema
- Study configuration schema

## Setup

### Prerequisites
- Azure subscription
- Azure CLI installed
- Python 3.11+
- Azure Functions Core Tools (for local testing)

### Deployment

1. **Deploy Infrastructure**
   ```bash
   cd infra/bicep
   az deployment group create \
     --resource-group rg-pdchk-dev-weu \
     --template-file main.bicep \
     --parameters environment=dev
   ```

2. **Configure Environment Variables**
   - Set app settings in Function Apps
   - Configure Key Vault secrets
   - Set Streamlit environment variables

3. **Deploy Functions**
   ```bash
   cd services/ingest_func
   func azure functionapp publish func-pdchk-dev-weu
   
   cd ../generator_api
   func azure functionapp publish func-pdchk-dev-weu
   ```

4. **Deploy Streamlit App**
   ```bash
   cd services/reviewer_ui
   # Build and push Docker image, then deploy to App Service
   ```

## Usage

### 1. Upload Documents
Upload PDF files to blob storage:
- `raw/protocol/` - Protocol documents
- `raw/crf/` - CRF specifications
- `raw/specs/` - DM specifications

### 2. Automatic Processing
- Event Grid triggers Document Intelligence extraction
- Extracted JSON saved to `extracted/` container

### 3. Generate Catalog
Call the generator API:
```bash
curl -X POST https://func-pdchk-dev-weu.azurewebsites.net/api/generate_catalog \
  -H "Content-Type: application/json" \
  -d '{"study_id": "DEMO-001"}'
```

### 4. Review & Approve
- Access Streamlit UI at App Service URL
- Review checks, approve/reject/edit
- Export approved catalog

## Development

### Local Testing

1. **Functions** (requires Azure Storage Emulator or real storage):
   ```bash
   cd services/ingest_func
   func start
   ```

2. **Streamlit**:
   ```bash
   cd services/reviewer_ui
   streamlit run app.py
   ```

### Project Structure
```
pd-check-factory/
├── infra/bicep/          # Infrastructure as code
├── schemas/              # JSON schemas
├── services/
│   ├── ingest_func/      # Document processing function
│   ├── generator_api/    # Catalog generation function
│   └── reviewer_ui/      # Streamlit review app
├── shared/python/        # Shared utilities
└── prompts/             # OpenAI prompt templates
```

## License

Internal use only - Bioscope

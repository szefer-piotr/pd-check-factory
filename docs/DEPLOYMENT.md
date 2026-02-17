# Deployment Guide

## Prerequisites

1. Azure subscription with appropriate permissions
2. Azure CLI installed and logged in
3. Python 3.11+ installed
4. Azure Functions Core Tools v4
5. Docker (for Streamlit deployment)

## Step 1: Deploy Infrastructure

### 1.1 Create Resource Group

```bash
az group create \
  --name rg-pdchk-dev-weu \
  --location westeurope
```

### 1.2 Deploy Bicep Templates

```bash
cd infra/bicep

az deployment group create \
  --resource-group rg-pdchk-dev-weu \
  --template-file main.bicep \
  --parameters \
    environment=dev \
    location=westeurope \
    prefix=pdchk \
    uniqueSuffix=01 \
    regionShort=weu
```

### 1.3 Note Output Values

After deployment, note the following outputs:
- Storage account name
- Function app name
- App service name
- Document Intelligence endpoint
- OpenAI endpoint

## Step 2: Configure Azure OpenAI

### 2.1 Create GPT-4 Deployment

1. Navigate to Azure OpenAI Studio
2. Create a new deployment named `gpt-4` (or update the deployment name in config)
3. Note the deployment name

### 2.2 Update Function App Settings

```bash
az functionapp config appsettings set \
  --name func-pdchk-dev-weu \
  --resource-group rg-pdchk-dev-weu \
  --settings \
    OPENAI_DEPLOYMENT=gpt-4
```

## Step 3: Deploy Azure Functions

### 3.1 Prepare Function Apps

```bash
# Ingest function
cd services/ingest_func
pip install -r requirements.txt

# Generator function
cd ../generator_api
pip install -r requirements.txt
```

### 3.2 Deploy Functions

```bash
# Deploy ingest function
cd services/ingest_func
func azure functionapp publish func-pdchk-dev-weu --python

# Deploy generator function (same function app, different functions)
cd ../generator_api
func azure functionapp publish func-pdchk-dev-weu --python
```

### 3.3 Configure Event Grid

The Event Grid subscription should be automatically created by the Bicep template. Verify:

```bash
az eventgrid system-topic list \
  --resource-group rg-pdchk-dev-weu
```

## Step 4: Deploy Streamlit App

### 4.1 Build Docker Image

```bash
cd services/reviewer_ui

# Build image
docker build -t pd-check-reviewer:latest .

# Tag for Azure Container Registry (if using ACR)
# az acr login --name <your-acr>
# docker tag pd-check-reviewer:latest <your-acr>.azurecr.io/pd-check-reviewer:latest
# docker push <your-acr>.azurecr.io/pd-check-reviewer:latest
```

### 4.2 Deploy to App Service

Option A: Using Azure Container Registry

```bash
az webapp config container set \
  --name app-pdchk-dev-weu \
  --resource-group rg-pdchk-dev-weu \
  --docker-custom-image-name <your-acr>.azurecr.io/pd-check-reviewer:latest \
  --docker-registry-server-url https://<your-acr>.azurecr.io
```

Option B: Using Docker Hub or local deployment

```bash
# Configure app to use container
az webapp config set \
  --name app-pdchk-dev-weu \
  --resource-group rg-pdchk-dev-weu \
  --linux-fx-version "DOCKER|<image-url>"
```

## Step 5: Configure Permissions

### 5.1 Function App Permissions

Ensure Function App has:
- Storage Blob Data Contributor role on storage account
- Key Vault Secrets User role (if using Key Vault)

### 5.2 App Service Permissions

Ensure App Service has:
- Storage Blob Data Reader role on storage account

## Step 6: Test End-to-End

### 6.1 Upload Test Document

```bash
# Upload a test PDF
az storage blob upload \
  --account-name stpdchkdevweu01 \
  --container-name raw \
  --name protocol/test_protocol.pdf \
  --file path/to/test.pdf
```

### 6.2 Verify Extraction

Check the `extracted/` container for the extracted JSON:
```bash
az storage blob list \
  --account-name stpdchkdevweu01 \
  --container-name extracted \
  --prefix protocol/
```

### 6.3 Generate Catalog

```bash
curl -X POST \
  "https://func-pdchk-dev-weu.azurewebsites.net/api/generate_catalog?code=<function-key>" \
  -H "Content-Type: application/json" \
  -d '{"study_id": "DEMO-001"}'
```

### 6.4 Access Review UI

Navigate to: `https://app-pdchk-dev-weu.azurewebsites.net`

## Troubleshooting

### Functions Not Triggering

1. Check Event Grid subscription status
2. Verify blob path matches trigger pattern
3. Check Function App logs in Application Insights

### Document Intelligence Errors

1. Verify endpoint and key in app settings
2. Check Document Intelligence resource is active
3. Verify PDF file is valid

### OpenAI Generation Fails

1. Verify deployment name matches
2. Check quota and limits
3. Review prompt length (may need chunking for large documents)

### Streamlit App Not Loading

1. Check container logs: `az webapp log tail`
2. Verify environment variables are set
3. Ensure storage account access is configured

## Next Steps

- Set up CI/CD pipeline
- Configure monitoring and alerts
- Add authentication to Streamlit app
- Set up backup and retention policies

@description('Main Bicep template orchestrating all resources for PD Check Factory')
param environment string = 'dev'
param location string = 'westeurope'
param prefix string = 'pdchk'
param uniqueSuffix string = '01'
param regionShort string = 'weu'

var resourceGroupName = 'rg-${prefix}-${environment}-${regionShort}'
var storageAccountName = 'st${prefix}${environment}${regionShort}${uniqueSuffix}'
var keyVaultName = 'kv-${prefix}-${environment}-${regionShort}'
var logAnalyticsName = 'log-${prefix}-${environment}-${regionShort}'
var appInsightsName = 'ai-${prefix}-${environment}-${regionShort}'
var appServiceName = 'app-${prefix}-${environment}-${regionShort}'
var functionAppName = 'func-${prefix}-${environment}-${regionShort}'
var openAIName = 'aoai-${prefix}-${environment}-${regionShort}'
var docIntelligenceName = 'cog-${prefix}-${environment}-${regionShort}'

var tags = {
  project: 'pd-check-factory'
  env: environment
  region: location
  owner: 'bioscope'
  managedBy: 'bicep'
  costCenter: 'innovation'
  dataSensitivity: 'internal'
}

// Storage Account
module storage 'storage.bicep' = {
  name: 'storage'
  params: {
    storageAccountName: storageAccountName
    location: location
    tags: tags
  }
}

// Key Vault
module keyVault 'keyvault.bicep' = {
  name: 'keyVault'
  params: {
    keyVaultName: keyVaultName
    location: location
    tags: tags
  }
}

// Log Analytics workspace
module logAnalytics 'log-analytics.bicep' = {
  name: 'logAnalytics'
  params: {
    workspaceName: logAnalyticsName
    location: location
    tags: tags
  }
}

// Application Insights (workspace-based)
module appInsights 'app-insights.bicep' = {
  name: 'appInsights'
  params: {
    appInsightsName: appInsightsName
    location: location
    tags: tags
    workspaceResourceId: logAnalytics.outputs.workspaceId
  }
}

// Cognitive Services (Document Intelligence)
module cognitive 'cognitive.bicep' = {
  name: 'cognitive'
  params: {
    docIntelligenceName: docIntelligenceName
    openAIName: openAIName
    location: location
    tags: tags
  }
}

// Function App
module functions 'functions.bicep' = {
  name: 'functions'
  params: {
    functionAppName: functionAppName
    storageAccountName: storageAccountName
    storageAccountId: storage.outputs.storageAccountId
    keyVaultName: keyVaultName
    keyVaultId: keyVault.outputs.keyVaultId
    appInsightsName: appInsightsName
    appInsightsInstrumentationKey: appInsights.outputs.instrumentationKey
    docIntelligenceEndpoint: cognitive.outputs.docIntelligenceEndpoint
    docIntelligenceKey: cognitive.outputs.docIntelligenceKey
    openAIEndpoint: cognitive.outputs.openAIEndpoint
    openAIKey: cognitive.outputs.openAIKey
    location: location
    tags: tags
  }
}

// App Service for Streamlit
module webapp 'webapp.bicep' = {
  name: 'webapp'
  params: {
    appServiceName: appServiceName
    storageAccountName: storageAccountName
    keyVaultName: keyVaultName
    appInsightsName: appInsightsName
    appInsightsInstrumentationKey: appInsights.outputs.instrumentationKey
    location: location
    tags: tags
  }
}

// RBAC: reference existing storage and key vault to assign roles to app identities
resource dataStorage 'Microsoft.Storage/storageAccounts@2023-01-01' existing = {
  name: storageAccountName
}

resource kv 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

var storageBlobDataContributorRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
var keyVaultSecretsUserRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')

// Function App: Storage Blob Data Contributor on data storage
resource funcStorageRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: dataStorage
  name: guid(dataStorage.id, functions.outputs.functionAppPrincipalId, storageBlobDataContributorRole)
  properties: {
    roleDefinitionId: storageBlobDataContributorRole
    principalId: functions.outputs.functionAppPrincipalId
    principalType: 'ServicePrincipal'
  }
}

// Function App: Key Vault Secrets User
resource funcKvRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: kv
  name: guid(kv.id, functions.outputs.functionAppPrincipalId, keyVaultSecretsUserRole)
  properties: {
    roleDefinitionId: keyVaultSecretsUserRole
    principalId: functions.outputs.functionAppPrincipalId
    principalType: 'ServicePrincipal'
  }
}

// Web App: Storage Blob Data Contributor on data storage
resource webStorageRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: dataStorage
  name: guid(dataStorage.id, webapp.outputs.webAppPrincipalId, storageBlobDataContributorRole)
  properties: {
    roleDefinitionId: storageBlobDataContributorRole
    principalId: webapp.outputs.webAppPrincipalId
    principalType: 'ServicePrincipal'
  }
}

// Web App: Key Vault Secrets User
resource webKvRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: kv
  name: guid(kv.id, webapp.outputs.webAppPrincipalId, keyVaultSecretsUserRole)
  properties: {
    roleDefinitionId: keyVaultSecretsUserRole
    principalId: webapp.outputs.webAppPrincipalId
    principalType: 'ServicePrincipal'
  }
}

output storageAccountName string = storageAccountName
output storageAccountId string = storage.outputs.storageAccountId
output functionAppName string = functionAppName
output appServiceName string = appServiceName
output keyVaultName string = keyVaultName
output docIntelligenceEndpoint string = cognitive.outputs.docIntelligenceEndpoint
output openAIEndpoint string = cognitive.outputs.openAIEndpoint

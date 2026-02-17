@description('Main Bicep template orchestrating all resources for PD Check Factory')
param environment string = 'dev'
param location string = 'westeurope'
param prefix string = 'pdchk'
param uniqueSuffix string = '01'
param regionShort string = 'weu'

var resourceGroupName = 'rg-${prefix}-${environment}-${regionShort}'
var storageAccountName = 'st${prefix}${environment}${regionShort}${uniqueSuffix}'
var keyVaultName = 'kv-${prefix}-${environment}-${regionShort}'
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

// Application Insights
module appInsights 'app-insights.bicep' = {
  name: 'appInsights'
  params: {
    appInsightsName: appInsightsName
    location: location
    tags: tags
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
    storageAccountKey: storage.outputs.storageAccountKey
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
    storageAccountKey: storage.outputs.storageAccountKey
    keyVaultName: keyVaultName
    appInsightsName: appInsightsName
    appInsightsInstrumentationKey: appInsights.outputs.instrumentationKey
    location: location
    tags: tags
  }
}

output storageAccountName string = storageAccountName
output storageAccountId string = storage.outputs.storageAccountId
output functionAppName string = functionAppName
output appServiceName string = appServiceName
output keyVaultName string = keyVaultName
output docIntelligenceEndpoint string = cognitive.outputs.docIntelligenceEndpoint
output openAIEndpoint string = cognitive.outputs.openAIEndpoint

@description('Azure Function App for document processing and catalog generation')
param functionAppName string
param storageAccountName string
param storageAccountId string
param storageAccountKey string
param keyVaultName string
param keyVaultId string
param appInsightsName string
param appInsightsInstrumentationKey string
param docIntelligenceEndpoint string
param docIntelligenceKey string
param openAIEndpoint string
param openAIKey string
param location string
param tags object

// Storage account for Function App (consumption plan requirement)
var functionStorageName = '${functionAppName}stg'

resource functionStorage 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: functionStorageName
  location: location
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  properties: {
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
  }
  tags: tags
}

// App Service Plan (Consumption)
resource hostingPlan 'Microsoft.Web/serverfarms@2023-01-01' = {
  name: '${functionAppName}-plan'
  location: location
  kind: 'functionapp'
  sku: {
    name: 'Y1'
    tier: 'Dynamic'
  }
  tags: tags
}

// Function App
resource functionApp 'Microsoft.Web/sites@2023-01-01' = {
  name: functionAppName
  location: location
  kind: 'functionapp'
  properties: {
    serverFarmId: hostingPlan.id
    siteConfig: {
      appSettings: [
        {
          name: 'AzureWebJobsStorage'
          value: 'DefaultEndpointsProtocol=https;AccountName=${functionStorage.name};EndpointSuffix=${environment().suffixes.storage};AccountKey=${functionStorage.listKeys().keys[0].value}'
        }
        {
          name: 'WEBSITE_CONTENTAZUREFILECONNECTIONSTRING'
          value: 'DefaultEndpointsProtocol=https;AccountName=${functionStorage.name};EndpointSuffix=${environment().suffixes.storage};AccountKey=${functionStorage.listKeys().keys[0].value}'
        }
        {
          name: 'WEBSITE_CONTENTSHARE'
          value: toLower(functionAppName)
        }
        {
          name: 'FUNCTIONS_EXTENSION_VERSION'
          value: '~4'
        }
        {
          name: 'FUNCTIONS_WORKER_RUNTIME'
          value: 'python'
        }
        {
          name: 'APPINSIGHTS_INSTRUMENTATIONKEY'
          value: appInsightsInstrumentationKey
        }
        {
          name: 'STORAGE_ACCOUNT_NAME'
          value: storageAccountName
        }
        {
          name: 'STORAGE_ACCOUNT_KEY'
          value: storageAccountKey
        }
        {
          name: 'DOC_INTELLIGENCE_ENDPOINT'
          value: docIntelligenceEndpoint
        }
        {
          name: 'DOC_INTELLIGENCE_KEY'
          value: docIntelligenceKey
        }
        {
          name: 'OPENAI_ENDPOINT'
          value: openAIEndpoint
        }
        {
          name: 'OPENAI_KEY'
          value: openAIKey
        }
        {
          name: 'KEY_VAULT_NAME'
          value: keyVaultName
        }
      ]
      pythonVersion: '3.11'
      http20Enabled: true
      minTlsVersion: '1.2'
    }
    httpsOnly: true
  }
  tags: tags
}

// Event Grid subscription for blob uploads
resource eventGridSubscription 'Microsoft.EventGrid/systemTopics@2022-06-15' = {
  name: '${functionAppName}-blob-events'
  location: location
  properties: {
    source: storageAccountId
    eventTypes: [
      'Microsoft.Storage.BlobCreated'
    ]
    destination: {
      endpointType: 'AzureFunction'
      properties: {
        resourceId: functionApp.id
        maxEventsPerBatch: 1
        preferredBatchSizeInKilobytes: 64
      }
    }
  }
}

output functionAppId string = functionApp.id
output functionAppName string = functionApp.name
output functionAppHostName string = functionApp.properties.defaultHostName

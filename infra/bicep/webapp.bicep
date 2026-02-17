@description('App Service for hosting Streamlit review UI')
param appServiceName string
param storageAccountName string
param storageAccountKey string
param keyVaultName string
param appInsightsName string
param appInsightsInstrumentationKey string
param location string
param tags object

// App Service Plan (Linux)
resource hostingPlan 'Microsoft.Web/serverfarms@2023-01-01' = {
  name: '${appServiceName}-plan'
  location: location
  kind: 'linux'
  properties: {
    reserved: true
  }
  sku: {
    name: 'B1'
    tier: 'Basic'
  }
  tags: tags
}

// App Service
resource webApp 'Microsoft.Web/sites@2023-01-01' = {
  name: appServiceName
  location: location
  kind: 'app,linux'
  properties: {
    serverFarmId: hostingPlan.id
    siteConfig: {
      linuxFxVersion: 'PYTHON|3.11'
      appSettings: [
        {
          name: 'STORAGE_ACCOUNT_NAME'
          value: storageAccountName
        }
        {
          name: 'STORAGE_ACCOUNT_KEY'
          value: storageAccountKey
        }
        {
          name: 'KEY_VAULT_NAME'
          value: keyVaultName
        }
        {
          name: 'APPINSIGHTS_INSTRUMENTATIONKEY'
          value: appInsightsInstrumentationKey
        }
        {
          name: 'WEBSITES_ENABLE_APP_SERVICE_STORAGE'
          value: 'false'
        }
      ]
      alwaysOn: false
      http20Enabled: true
      minTlsVersion: '1.2'
    }
    httpsOnly: true
  }
  tags: tags
}

output appServiceId string = webApp.id
output appServiceName string = webApp.name
output appServiceHostName string = webApp.properties.defaultHostName

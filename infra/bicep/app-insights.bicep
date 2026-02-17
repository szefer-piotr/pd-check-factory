@description('Application Insights for monitoring')
param appInsightsName string
param location string
param tags object

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    Request_Source: 'rest'
    IngestionMode: 'ApplicationInsights'
  }
  tags: tags
}

output instrumentationKey string = appInsights.properties.InstrumentationKey
output appId string = appInsights.properties.AppId
output connectionString string = appInsights.properties.ConnectionString

@description('Log Analytics workspace for centralized logs and App Insights backend')
param workspaceName string
param location string
param tags object

resource workspace 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: workspaceName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
  tags: tags
}

output workspaceId string = workspace.id
output workspaceName string = workspace.name

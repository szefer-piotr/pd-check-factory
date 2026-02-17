@description('Cognitive Services: Document Intelligence and Azure OpenAI')
param docIntelligenceName string
param openAIName string
param location string
param tags object

// Document Intelligence (Form Recognizer)
resource docIntelligence 'Microsoft.CognitiveServices/accounts@2023-05-01' = {
  name: docIntelligenceName
  location: location
  kind: 'FormRecognizer'
  sku: {
    name: 'S0'
  }
  properties: {
    apiProperties: {}
  }
  tags: tags
}

// Azure OpenAI
resource openAI 'Microsoft.CognitiveServices/accounts@2023-05-01' = {
  name: openAIName
  location: location
  kind: 'OpenAI'
  sku: {
    name: 'S0'
  }
  properties: {
    apiProperties: {}
  }
  tags: tags
}

output docIntelligenceEndpoint string = 'https://${docIntelligence.name}.cognitiveservices.azure.com/'
output docIntelligenceKey string = docIntelligence.listKeys().key1
output openAIEndpoint string = 'https://${openAI.name}.openai.azure.com/'
output openAIKey string = openAI.listKeys().key1

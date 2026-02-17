"""
Configuration loader for PD Check Factory
"""
import os
from typing import Optional
from azure.identity import DefaultAzureCredential
from azure.keyvault.secrets import SecretClient


class Config:
    """Application configuration"""
    
    def __init__(self):
        self.storage_account_name = os.getenv("STORAGE_ACCOUNT_NAME", "")
        self.storage_account_key = os.getenv("STORAGE_ACCOUNT_KEY", "")
        self.doc_intelligence_endpoint = os.getenv("DOC_INTELLIGENCE_ENDPOINT", "")
        self.doc_intelligence_key = os.getenv("DOC_INTELLIGENCE_KEY", "")
        self.openai_endpoint = os.getenv("OPENAI_ENDPOINT", "")
        self.openai_key = os.getenv("OPENAI_KEY", "")
        self.openai_deployment = os.getenv("OPENAI_DEPLOYMENT", "gpt-4")
        self.key_vault_name = os.getenv("KEY_VAULT_NAME", "")
        
        # Try to load from Key Vault if available
        if self.key_vault_name:
            try:
                self._load_from_key_vault()
            except Exception as e:
                print(f"Warning: Could not load from Key Vault: {e}")
    
    def _load_from_key_vault(self):
        """Load secrets from Azure Key Vault"""
        if not self.key_vault_name:
            return
        
        credential = DefaultAzureCredential()
        vault_url = f"https://{self.key_vault_name}.vault.azure.net/"
        client = SecretClient(vault_url=vault_url, credential=credential)
        
        # Only override if not already set from environment
        if not self.storage_account_key:
            self.storage_account_key = client.get_secret("storage-account-key").value
        if not self.doc_intelligence_key:
            self.doc_intelligence_key = client.get_secret("doc-intelligence-key").value
        if not self.openai_key:
            self.openai_key = client.get_secret("openai-key").value
    
    def get_storage_connection_string(self) -> str:
        """Get Azure Storage connection string"""
        return (
            f"DefaultEndpointsProtocol=https;"
            f"AccountName={self.storage_account_name};"
            f"AccountKey={self.storage_account_key};"
            f"EndpointSuffix=core.windows.net"
        )


# Global config instance
config = Config()

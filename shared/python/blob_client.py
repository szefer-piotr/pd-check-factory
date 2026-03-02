"""
Shared Azure Blob Storage client utilities
"""
import json
from datetime import datetime
from typing import Optional, List
from azure.storage.blob import BlobServiceClient
from azure.identity import DefaultAzureCredential
from shared.python.config import config


class BlobClientWrapper:
    """Wrapper for Azure Blob Storage operations. Uses connection string when key is set, otherwise Managed Identity."""

    def __init__(self):
        connection_string = config.get_storage_connection_string()
        if connection_string:
            self.client = BlobServiceClient.from_connection_string(connection_string)
        else:
            account_url = config.get_storage_account_url()
            if not account_url:
                raise ValueError("STORAGE_ACCOUNT_NAME must be set")
            self.client = BlobServiceClient(account_url=account_url, credential=DefaultAzureCredential())
    
    def upload_json(self, container_name: str, blob_name: str, data: dict) -> None:
        """Upload a JSON object to blob storage"""
        blob_client = self.client.get_blob_client(container=container_name, blob=blob_name)
        json_str = json.dumps(data, indent=2, default=str)
        blob_client.upload_blob(json_str, overwrite=True)
    
    def download_json(self, container_name: str, blob_name: str) -> Optional[dict]:
        """Download and parse a JSON blob"""
        try:
            blob_client = self.client.get_blob_client(container=container_name, blob=blob_name)
            json_str = blob_client.download_blob().readall().decode('utf-8')
            return json.loads(json_str)
        except Exception as e:
            print(f"Error downloading {blob_name}: {e}")
            return None
    
    def list_blobs(self, container_name: str, prefix: Optional[str] = None) -> List[str]:
        """List all blobs in a container with optional prefix"""
        container_client = self.client.get_container_client(container_name)
        blobs = container_client.list_blobs(name_starts_with=prefix)
        return [blob.name for blob in blobs]
    
    def blob_exists(self, container_name: str, blob_name: str) -> bool:
        """Check if a blob exists"""
        blob_client = self.client.get_blob_client(container=container_name, blob=blob_name)
        return blob_client.exists()
    
    def delete_blob(self, container_name: str, blob_name: str) -> None:
        """Delete a blob"""
        blob_client = self.client.get_blob_client(container=container_name, blob=blob_name)
        blob_client.delete_blob()
    
    def upload_file(self, container_name: str, blob_name: str, file_path: str) -> None:
        """Upload a file to blob storage"""
        blob_client = self.client.get_blob_client(container=container_name, blob=blob_name)
        with open(file_path, "rb") as data:
            blob_client.upload_blob(data, overwrite=True)
    
    def download_file(self, container_name: str, blob_name: str, file_path: str) -> None:
        """Download a blob to a local file"""
        blob_client = self.client.get_blob_client(container=container_name, blob=blob_name)
        with open(file_path, "wb") as download_file:
            download_file.write(blob_client.download_blob().readall())
    
    def get_blob_url(self, container_name: str, blob_name: str) -> str:
        """Get the URL for a blob"""
        return f"https://{config.storage_account_name}.blob.core.windows.net/{container_name}/{blob_name}"

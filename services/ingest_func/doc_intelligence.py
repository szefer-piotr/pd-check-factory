"""
Document Intelligence client wrapper with helper functions
"""
from typing import Dict, Any, Optional
from azure.ai.documentintelligence import DocumentIntelligenceClient
from azure.ai.documentintelligence.models import AnalyzeDocumentRequest
from azure.core.credentials import AzureKeyCredential
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).parent.parent.parent / "shared" / "python"))
from config import config


class DocumentIntelligenceService:
    """Service wrapper for Azure Document Intelligence"""
    
    def __init__(self):
        self.client = DocumentIntelligenceClient(
            endpoint=config.doc_intelligence_endpoint,
            credential=AzureKeyCredential(config.doc_intelligence_key)
        )
    
    def analyze_document(self, document_bytes: bytes, model_id: str = "prebuilt-layout") -> Dict[str, Any]:
        """
        Analyze a document using Document Intelligence
        
        Args:
            document_bytes: PDF document as bytes
            model_id: Model to use (default: prebuilt-layout)
        
        Returns:
            Analysis result as dictionary
        """
        poller = self.client.begin_analyze_document(
            model_id=model_id,
            analyze_request=document_bytes,
            content_type="application/pdf"
        )
        result = poller.result()
        return result.as_dict()
    
    def extract_text(self, document_bytes: bytes) -> str:
        """Extract all text from a document"""
        result = self.analyze_document(document_bytes)
        return result.get("content", "")
    
    def extract_tables(self, document_bytes: bytes) -> list:
        """Extract all tables from a document"""
        result = self.analyze_document(document_bytes)
        return result.get("tables", [])

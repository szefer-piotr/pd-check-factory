"""
Azure Function for processing uploaded PDF documents with Document Intelligence
Triggered by Event Grid when a blob is created in the 'raw' container
"""
import json
import logging
import sys
from pathlib import Path
from datetime import datetime
from typing import Dict, Any

import azure.functions as func
from azure.storage.blob import BlobServiceClient
from azure.ai.documentintelligence import DocumentIntelligenceClient
from azure.ai.documentintelligence.models import AnalyzeDocumentRequest, ContentFormat
from azure.core.credentials import AzureKeyCredential

# Add shared module to path
sys.path.append(str(Path(__file__).parent.parent.parent / "shared" / "python"))

from config import config
from blob_client import BlobClientWrapper
from schemas import ExtractedDocument, Page, Section, Table, Paragraph, KeyValuePair

app = func.FunctionApp()

# Initialize clients
blob_wrapper = BlobClientWrapper()
doc_intelligence_client = DocumentIntelligenceClient(
    endpoint=config.doc_intelligence_endpoint,
    credential=AzureKeyCredential(config.doc_intelligence_key)
)


def transform_di_result(result: Dict[str, Any], source_file: str, doc_type: str) -> ExtractedDocument:
    """
    Transform Document Intelligence result to our ExtractedDocument schema
    """
    pages = []
    sections = []
    tables = []
    paragraphs = []
    key_value_pairs = []
    
    # Extract pages
    if "pages" in result:
        for page_data in result["pages"]:
            pages.append(Page(
                page_number=page_data.get("pageNumber", 0),
                width=page_data.get("width", 0),
                height=page_data.get("height", 0),
                text=page_data.get("content", "")
            ))
    
    # Extract paragraphs (with reading order)
    if "paragraphs" in result:
        for idx, para_data in enumerate(result["paragraphs"]):
            paragraphs.append(Paragraph(
                content=para_data.get("content", ""),
                page=para_data.get("boundingRegions", [{}])[0].get("pageNumber", 1) if para_data.get("boundingRegions") else 1,
                order=idx
            ))
    
    # Extract tables
    if "tables" in result:
        for table_data in result["tables"]:
            rows = []
            headers = None
            
            if "rowCount" in table_data and "columnCount" in table_data:
                # Extract cells and organize into rows
                cells = table_data.get("cells", [])
                row_dict = {}
                
                for cell in cells:
                    row_idx = cell.get("rowIndex", 0)
                    col_idx = cell.get("columnIndex", 0)
                    content = cell.get("content", "")
                    
                    if row_idx not in row_dict:
                        row_dict[row_idx] = {}
                    row_dict[row_idx][col_idx] = content
                
                # Convert to list of lists
                max_row = max(row_dict.keys()) if row_dict else 0
                max_col = max(max(row_dict[r].keys()) if row_dict[r] else [0]) for r in row_dict) if row_dict else 0
                
                for r in range(max_row + 1):
                    row = []
                    for c in range(max_col + 1):
                        row.append(row_dict.get(r, {}).get(c, ""))
                    rows.append(row)
                
                # First row might be headers
                if rows:
                    headers = rows[0]
            
            tables.append(Table(
                id=f"table_{len(tables) + 1}",
                page=table_data.get("boundingRegions", [{}])[0].get("pageNumber", 1) if table_data.get("boundingRegions") else 1,
                caption=None,  # Document Intelligence doesn't extract captions directly
                row_count=len(rows),
                column_count=len(rows[0]) if rows else 0,
                rows=rows,
                headers=headers
            ))
    
    # Extract sections (from paragraphs with heading-like content)
    # This is a simplified approach - in production, you might use more sophisticated heading detection
    current_section = None
    for para in paragraphs:
        content = para.content.strip()
        # Simple heuristic: if paragraph is short and all caps or starts with number, it might be a heading
        if len(content) < 100 and (content.isupper() or content[0].isdigit() if content else False):
            if current_section:
                sections.append(current_section)
            current_section = Section(
                heading=content,
                level=1,  # Simplified - could be improved
                content="",
                page=para.page
            )
        elif current_section:
            current_section.content += " " + content
    
    if current_section:
        sections.append(current_section)
    
    # Extract key-value pairs (if available in result)
    if "keyValuePairs" in result:
        for kv in result["keyValuePairs"]:
            key_value_pairs.append(KeyValuePair(
                key=kv.get("key", {}).get("content", ""),
                value=kv.get("value", {}).get("content", ""),
                confidence=kv.get("confidence", 0.0)
            ))
    
    return ExtractedDocument(
        source_file=source_file,
        doc_type=doc_type,
        extracted_at=datetime.utcnow(),
        pages=pages,
        sections=sections,
        tables=tables,
        paragraphs=paragraphs,
        key_value_pairs=key_value_pairs
    )


@app.event_grid_trigger(arg_name="event")
def process_document(event: func.EventGridEvent):
    """
    Process a document when it's uploaded to the raw container
    Event Grid trigger fires on blob creation
    """
    logging.info(f"Event received: {event.get_json()}")
    
    try:
        # Parse event data
        event_data = event.get_json()
        blob_url = event_data.get("data", {}).get("url", "")
        
        if not blob_url:
            logging.error("No blob URL in event data")
            return
        
        # Extract container and blob name from URL
        # URL format: https://{account}.blob.core.windows.net/{container}/{blob_path}
        parts = blob_url.split("/")
        container_name = parts[4] if len(parts) > 4 else ""
        blob_path = "/".join(parts[5:]) if len(parts) > 5 else ""
        
        if container_name != "raw":
            logging.info(f"Ignoring blob in container: {container_name}")
            return
        
        # Determine doc_type from path (raw/protocol/, raw/crf/, raw/specs/)
        path_parts = blob_path.split("/")
        doc_type = path_parts[0] if path_parts else "unknown"
        filename = path_parts[-1] if path_parts else blob_path
        
        if doc_type not in ["protocol", "crf", "specs"]:
            logging.warning(f"Unknown document type: {doc_type}")
            return
        
        # Only process PDF files
        if not filename.lower().endswith(".pdf"):
            logging.info(f"Skipping non-PDF file: {filename}")
            return
        
        logging.info(f"Processing document: {filename} (type: {doc_type})")
        
        # Download blob to memory
        blob_client = blob_wrapper.client.get_blob_client(
            container=container_name,
            blob=blob_path
        )
        blob_data = blob_client.download_blob().readall()
        
        # Call Document Intelligence
        logging.info("Calling Document Intelligence...")
        poller = doc_intelligence_client.begin_analyze_document(
            model_id="prebuilt-layout",
            analyze_request=blob_data,
            content_type="application/pdf"
        )
        result = poller.result()
        
        # Transform to our schema
        extracted_doc = transform_di_result(
            result.as_dict(),
            source_file=filename,
            doc_type=doc_type
        )
        
        # Save extracted document to blob storage
        output_path = f"{doc_type}/{filename}_extracted.json"
        extracted_dict = extracted_doc.model_dump(mode="json", exclude_none=True)
        blob_wrapper.upload_json("extracted", output_path, extracted_dict)
        
        logging.info(f"Saved extracted document to: extracted/{output_path}")
        
        # Log to audit
        audit_entry = {
            "timestamp": datetime.utcnow().isoformat(),
            "event": "extraction_complete",
            "source_file": filename,
            "doc_type": doc_type,
            "extracted_path": output_path,
            "pages": len(extracted_doc.pages),
            "tables": len(extracted_doc.tables),
            "sections": len(extracted_doc.sections)
        }
        audit_path = f"extraction_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_{filename}.json"
        blob_wrapper.upload_json("audit", audit_path, audit_entry)
        
        logging.info(f"Document processing complete: {filename}")
        
    except Exception as e:
        logging.error(f"Error processing document: {str(e)}", exc_info=True)
        # Log error to audit
        error_entry = {
            "timestamp": datetime.utcnow().isoformat(),
            "event": "extraction_error",
            "error": str(e),
            "blob_url": blob_url if 'blob_url' in locals() else "unknown"
        }
        error_path = f"error_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.json"
        blob_wrapper.upload_json("audit", error_path, error_entry)
        raise

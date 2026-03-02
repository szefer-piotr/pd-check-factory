"""
Azure Function for generating PD Check Catalogs using Azure OpenAI
HTTP triggered function that processes extracted documents and generates catalogs
"""
import json
import logging
import sys
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, Optional, List, Tuple

import azure.functions as func
from openai import AzureOpenAI
import jsonschema

# Add shared module to path
sys.path.append(str(Path(__file__).parent.parent.parent / "shared" / "python"))

from config import config
from blob_client import BlobClientWrapper
from schemas import PDCheckCatalog, ExtractedDocument

app = func.FunctionApp()

# Initialize clients
blob_wrapper = BlobClientWrapper()
openai_client = AzureOpenAI(
    api_key=config.openai_key,
    api_version="2024-02-15-preview",
    azure_endpoint=config.openai_endpoint
)


@app.route(route="hello", methods=["GET"], auth_level=func.AuthLevel.ANONYMOUS)
def hello(req: func.HttpRequest) -> func.HttpResponse:
    """
    Hello-world endpoint for Phase 1 verification: writes a blob to outputs/ and logs.
    Verify in Azure Portal: Storage -> outputs container; App Insights -> Logs.
    """
    logger = logging.getLogger(__name__)
    try:
        ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        blob_name = f"hello_{ts}.txt"
        content = f"Hello from PD Check Factory at {datetime.utcnow().isoformat()}Z"
        blob_wrapper.client.get_blob_client(container="outputs", blob=blob_name).upload_blob(
            content, overwrite=True
        )
        logger.info("Hello world from PD Check Factory")
        return func.HttpResponse(
            json.dumps({"message": "Hello world", "blob": f"outputs/{blob_name}"}),
            status_code=200,
            mimetype="application/json",
        )
    except Exception as e:
        logger.exception("Hello endpoint failed")
        return func.HttpResponse(
            json.dumps({"error": str(e)}),
            status_code=500,
            mimetype="application/json",
        )


def load_prompt_template(template_name: str) -> str:
    """Load a prompt template from the prompts directory"""
    prompt_path = Path(__file__).parent.parent.parent / "prompts" / f"{template_name}.md"
    if prompt_path.exists():
        return prompt_path.read_text()
    return ""


def load_catalog_schema() -> Dict[str, Any]:
    """Load the catalog JSON schema for validation"""
    schema_path = Path(__file__).parent.parent.parent / "schemas" / "pd_check_catalog.json"
    if schema_path.exists():
        return json.loads(schema_path.read_text())
    return {}


def build_catalog_prompt(extracted_docs: List[ExtractedDocument], study_id: str) -> str:
    """Build the prompt for catalog generation"""
    system_prompt = load_prompt_template("catalog_generator")
    
    # Build document content sections
    doc_sections = []
    for doc in extracted_docs:
        doc_text = f"\n## {doc.doc_type.upper()} Document: {doc.source_file}\n\n"
        
        # Add sections
        if doc.sections:
            doc_text += "### Sections:\n"
            for section in doc.sections:
                doc_text += f"- **{section.heading}** (Page {section.page}): {section.content[:200]}...\n"
        
        # Add tables (especially important for visit schedules)
        if doc.tables:
            doc_text += "\n### Tables:\n"
            for table in doc.tables:
                doc_text += f"\n**Table {table.id}** (Page {table.page}): {table.caption or 'No caption'}\n"
                if table.headers:
                    doc_text += f"Headers: {', '.join(table.headers)}\n"
                # Show first few rows
                for i, row in enumerate(table.rows[:3]):
                    doc_text += f"Row {i+1}: {', '.join(row)}\n"
        
        doc_sections.append(doc_text)
    
    user_prompt = f"""
# Study: {study_id}

## Extracted Documents

{''.join(doc_sections)}

## Task

Generate a PD Check Catalog for study {study_id} based on the documents above. 
Include 5-10 checks covering different categories (timing, missing, sequence, inclusion, dose).

Output ONLY valid JSON matching the PD Check Catalog schema. No markdown, no explanations.
"""
    
    return system_prompt, user_prompt


def validate_catalog(catalog_dict: Dict[str, Any]) -> Tuple[bool, List[str]]:
    """Validate catalog against JSON schema"""
    schema = load_catalog_schema()
    if not schema:
        return True, []  # Skip validation if schema not found
    
    errors = []
    try:
        jsonschema.validate(instance=catalog_dict, schema=schema)
        return True, []
    except jsonschema.ValidationError as e:
        errors.append(f"Schema validation error: {e.message}")
        return False, errors
    except Exception as e:
        errors.append(f"Validation error: {str(e)}")
        return False, errors


@app.route(route="generate_catalog", methods=["POST"], auth_level=func.AuthLevel.FUNCTION)
def generate_catalog(req: func.HttpRequest) -> func.HttpResponse:
    """
    Generate a PD Check Catalog from extracted documents
    
    Request body:
    {
        "study_id": "DEMO-001",
        "doc_types": ["protocol", "crf"],  # Optional, defaults to all
        "version": 1  # Optional, will auto-increment if not provided
    }
    """
    try:
        req_body = req.get_json()
        study_id = req_body.get("study_id")
        doc_types = req_body.get("doc_types", ["protocol", "crf", "specs"])
        version = req_body.get("version")
        
        if not study_id:
            return func.HttpResponse(
                json.dumps({"error": "study_id is required"}),
                status_code=400,
                mimetype="application/json"
            )
        
        logging.info(f"Generating catalog for study: {study_id}")
        
        # Load extracted documents
        extracted_docs = []
        for doc_type in doc_types:
            # List all extracted documents of this type
            blobs = blob_wrapper.list_blobs("extracted", prefix=f"{doc_type}/")
            for blob_name in blobs:
                if blob_name.endswith("_extracted.json"):
                    doc_data = blob_wrapper.download_json("extracted", blob_name)
                    if doc_data:
                        try:
                            extracted_doc = ExtractedDocument(**doc_data)
                            extracted_docs.append(extracted_doc)
                        except Exception as e:
                            logging.warning(f"Failed to parse {blob_name}: {e}")
        
        if not extracted_docs:
            return func.HttpResponse(
                json.dumps({"error": f"No extracted documents found for types: {doc_types}"}),
                status_code=404,
                mimetype="application/json"
            )
        
        logging.info(f"Loaded {len(extracted_docs)} extracted documents")
        
        # Determine version
        if not version:
            # Find latest version
            catalog_blobs = blob_wrapper.list_blobs("catalogs", prefix=f"{study_id}/")
            versions = []
            for blob_name in catalog_blobs:
                if "catalog_v" in blob_name:
                    try:
                        v = int(blob_name.split("catalog_v")[1].split(".")[0])
                        versions.append(v)
                    except:
                        pass
            version = max(versions) + 1 if versions else 1
        
        # Build prompt
        system_prompt, user_prompt = build_catalog_prompt(extracted_docs, study_id)
        
        # Call OpenAI
        logging.info("Calling Azure OpenAI...")
        response = openai_client.chat.completions.create(
            model=config.openai_deployment,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            temperature=0.3,
            response_format={"type": "json_object"}
        )
        
        # Parse response
        catalog_json = json.loads(response.choices[0].message.content)
        
        # Add metadata
        catalog_json["study_id"] = study_id
        catalog_json["version"] = version
        catalog_json["created_at"] = datetime.utcnow().isoformat() + "Z"
        catalog_json["status"] = "draft"
        
        # Validate
        is_valid, errors = validate_catalog(catalog_json)
        if not is_valid:
            logging.warning(f"Catalog validation errors: {errors}")
            # Still save but mark as needing review
        
        # Save catalog
        catalog_path = f"{study_id}/catalog_v{version}.json"
        blob_wrapper.upload_json("catalogs", catalog_path, catalog_json)
        
        logging.info(f"Catalog saved to: catalogs/{catalog_path}")
        
        # Log to audit
        audit_entry = {
            "timestamp": datetime.utcnow().isoformat(),
            "event": "catalog_generated",
            "study_id": study_id,
            "version": version,
            "catalog_path": catalog_path,
            "checks_count": len(catalog_json.get("checks", [])),
            "validation_errors": errors
        }
        audit_path = f"catalog_gen_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_{study_id}.json"
        blob_wrapper.upload_json("audit", audit_path, audit_entry)
        
        return func.HttpResponse(
            json.dumps({
                "success": True,
                "study_id": study_id,
                "version": version,
                "catalog_path": catalog_path,
                "checks_count": len(catalog_json.get("checks", [])),
                "validation_errors": errors
            }),
            status_code=200,
            mimetype="application/json"
        )
        
    except Exception as e:
        logging.error(f"Error generating catalog: {str(e)}", exc_info=True)
        return func.HttpResponse(
            json.dumps({"error": str(e)}),
            status_code=500,
            mimetype="application/json"
        )


@app.route(route="validate_catalog", methods=["POST"], auth_level=func.AuthLevel.FUNCTION)
def validate_catalog_endpoint(req: func.HttpRequest) -> func.HttpResponse:
    """
    Validate an existing catalog
    
    Request body:
    {
        "study_id": "DEMO-001",
        "version": 1
    }
    """
    try:
        req_body = req.get_json()
        study_id = req_body.get("study_id")
        version = req_body.get("version", 1)
        
        if not study_id:
            return func.HttpResponse(
                json.dumps({"error": "study_id is required"}),
                status_code=400,
                mimetype="application/json"
            )
        
        # Load catalog
        catalog_path = f"{study_id}/catalog_v{version}.json"
        catalog_dict = blob_wrapper.download_json("catalogs", catalog_path)
        
        if not catalog_dict:
            return func.HttpResponse(
                json.dumps({"error": f"Catalog not found: {catalog_path}"}),
                status_code=404,
                mimetype="application/json"
            )
        
        # Validate
        is_valid, errors = validate_catalog(catalog_dict)
        
        return func.HttpResponse(
            json.dumps({
                "valid": is_valid,
                "errors": errors,
                "study_id": study_id,
                "version": version
            }),
            status_code=200,
            mimetype="application/json"
        )
        
    except Exception as e:
        logging.error(f"Error validating catalog: {str(e)}", exc_info=True)
        return func.HttpResponse(
            json.dumps({"error": str(e)}),
            status_code=500,
            mimetype="application/json"
        )

import os
import base64
from azure.core.credentials import AzureKeyCredential
from azure.ai.documentintelligence import DocumentIntelligenceClient
from azure.ai.documentintelligence.models import AnalyzeDocumentRequest

from dotenv import load_dotenv
load_dotenv()

ENDPOINT = os.environ["DI_ENDPOINT"]
KEY = os.environ["DI_KEY"]
PDF_PATH = os.environ.get("PDF_PATH", "sample_data/demo_study/protocol/protocol.pdf")

client = DocumentIntelligenceClient(endpoint=ENDPOINT, credential=AzureKeyCredential(KEY))

with open(PDF_PATH, "rb") as f:
    pdf_bytes = f.read()

poller = client.begin_analyze_document(
    model_id="prebuilt-layout",
    body=AnalyzeDocumentRequest(bytes_source=pdf_bytes),
)

result = poller.result()

print("Pages:", len(result.pages))
print("Tables:", len(result.tables) if result.tables else 0)

# Print first page lines (smoke check)
if result.pages and result.pages[0].lines:
    for line in result.pages[0].lines[:10]:
        print(line.content)
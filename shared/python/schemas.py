"""
Pydantic models for PD Check Factory schemas
"""
from datetime import datetime
from typing import List, Optional, Dict, Any, Literal, Tuple
from pydantic import BaseModel, Field, field_validator


class Page(BaseModel):
    """Page object from Document Intelligence"""
    page_number: int
    width: float
    height: float
    text: str


class Section(BaseModel):
    """Document section with heading"""
    heading: str
    level: int = Field(ge=1, le=6)
    content: str
    page: int


class Table(BaseModel):
    """Extracted table from document"""
    id: str
    page: int
    caption: Optional[str] = None
    row_count: int
    column_count: int
    rows: List[List[str]]
    headers: Optional[List[str]] = None


class Paragraph(BaseModel):
    """Paragraph with reading order"""
    content: str
    page: int
    order: int


class KeyValuePair(BaseModel):
    """Key-value pair extracted from document"""
    key: str
    value: str
    confidence: Optional[float] = Field(None, ge=0, le=1)


class ExtractedDocument(BaseModel):
    """Document extracted by Azure Document Intelligence"""
    source_file: str
    doc_type: Literal["protocol", "crf", "specs"]
    extracted_at: datetime
    pages: List[Page] = []
    sections: List[Section] = []
    tables: List[Table] = []
    paragraphs: List[Paragraph] = []
    key_value_pairs: List[KeyValuePair] = []


class ProtocolReference(BaseModel):
    """Reference to a protocol section"""
    doc: str
    section: Optional[str] = None
    page: Optional[int] = None
    table_id: Optional[str] = None


class DatasetInput(BaseModel):
    """Input dataset and columns for a check"""
    dataset: str
    columns: List[str] = []
    join_keys: List[str] = []


class CheckLogic(BaseModel):
    """Structured check logic definition"""
    type: Literal["window_check", "missing_check", "sequence_check", "inclusion_check", "dose_timing", "custom"]
    description: str
    # Allow additional fields for specific logic types
    model_config = {"extra": "allow"}


class PDCheck(BaseModel):
    """Individual PD check definition"""
    check_id: str = Field(pattern=r"^CHK\d{3,}$")
    name: str
    category: Literal["timing", "missing", "sequence", "inclusion", "dose", "other"]
    severity: Literal["critical", "major", "minor", "info"]
    protocol_refs: List[ProtocolReference]
    inputs: List[DatasetInput]
    logic: CheckLogic
    output_message: str
    output_fields: List[str] = []
    dm_status: Literal["pending_review", "approved", "rejected", "needs_revision"] = "pending_review"
    dm_comments: Optional[str] = None
    dm_reviewed_at: Optional[datetime] = None
    dm_reviewed_by: Optional[str] = None


class CatalogMetadata(BaseModel):
    """Metadata about the catalog"""
    protocol_version: Optional[str] = None
    source_documents: List[str] = []
    total_checks: Optional[int] = None


class PDCheckCatalog(BaseModel):
    """PD Check catalog containing multiple checks"""
    study_id: str
    version: int = Field(ge=1)
    created_at: datetime
    created_by: Optional[str] = None
    status: Literal["draft", "pending_review", "approved", "rejected"] = "draft"
    checks: List[PDCheck]
    metadata: Optional[CatalogMetadata] = None


class StudyConfig(BaseModel):
    """Study configuration"""
    study_id: str
    protocol_version: str
    dataset_paths: Dict[str, str] = {}
    id_columns: Dict[str, str] = Field(default_factory=lambda: {
        "subject_id": "USUBJID",
        "visit_id": "VISITNUM"
    })
    timezone: str = "UTC"
    date_format: str = "ISO8601"

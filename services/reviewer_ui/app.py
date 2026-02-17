"""
Streamlit app for reviewing and approving PD Check Catalogs
"""
import streamlit as st
import json
import sys
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, List, Optional

# Add shared module to path
sys.path.append(str(Path(__file__).parent.parent.parent / "shared" / "python"))

from blob_client import BlobClientWrapper
from schemas import PDCheckCatalog, PDCheck, ProtocolReference, DatasetInput, CheckLogic

# Page config
st.set_page_config(
    page_title="PD Check Catalog Reviewer",
    page_icon="📋",
    layout="wide"
)

# Initialize blob client
@st.cache_resource
def get_blob_client():
    return BlobClientWrapper()

blob_wrapper = get_blob_client()


def load_catalog(study_id: str, version: int) -> Optional[PDCheckCatalog]:
    """Load a catalog from blob storage"""
    catalog_path = f"{study_id}/catalog_v{version}.json"
    catalog_dict = blob_wrapper.download_json("catalogs", catalog_path)
    if catalog_dict:
        try:
            return PDCheckCatalog(**catalog_dict)
        except Exception as e:
            st.error(f"Error parsing catalog: {e}")
            return None
    return None


def save_catalog(catalog: PDCheckCatalog) -> bool:
    """Save a catalog to blob storage"""
    try:
        catalog_path = f"{catalog.study_id}/catalog_v{catalog.version}.json"
        catalog_dict = catalog.model_dump(mode="json", exclude_none=True)
        blob_wrapper.upload_json("catalogs", catalog_path, catalog_dict)
        return True
    except Exception as e:
        st.error(f"Error saving catalog: {e}")
        return False


def list_studies() -> List[str]:
    """List all studies with catalogs"""
    blobs = blob_wrapper.list_blobs("catalogs")
    studies = set()
    for blob_name in blobs:
        if "/" in blob_name:
            study_id = blob_name.split("/")[0]
            studies.add(study_id)
    return sorted(list(studies))


def get_catalog_versions(study_id: str) -> List[int]:
    """Get all versions for a study"""
    blobs = blob_wrapper.list_blobs("catalogs", prefix=f"{study_id}/")
    versions = []
    for blob_name in blobs:
        if "catalog_v" in blob_name:
            try:
                v = int(blob_name.split("catalog_v")[1].split(".")[0])
                versions.append(v)
            except:
                pass
    return sorted(versions, reverse=True)


def main():
    st.title("📋 PD Check Catalog Reviewer")
    st.markdown("Review, approve, and edit PD Check Catalogs")
    
    # Sidebar for study selection
    with st.sidebar:
        st.header("Study Selection")
        
        studies = list_studies()
        if not studies:
            st.warning("No catalogs found. Upload documents and generate a catalog first.")
            return
        
        selected_study = st.selectbox("Select Study", studies)
        
        if selected_study:
            versions = get_catalog_versions(selected_study)
            if versions:
                selected_version = st.selectbox("Select Version", versions, index=0)
            else:
                st.warning("No versions found for this study")
                return
    
    # Load catalog
    if selected_study and selected_version:
        catalog = load_catalog(selected_study, selected_version)
        
        if not catalog:
            st.error(f"Could not load catalog for {selected_study} v{selected_version}")
            return
        
        # Display catalog metadata
        col1, col2, col3, col4 = st.columns(4)
        with col1:
            st.metric("Study ID", catalog.study_id)
        with col2:
            st.metric("Version", catalog.version)
        with col3:
            status_color = {
                "draft": "gray",
                "pending_review": "orange",
                "approved": "green",
                "rejected": "red"
            }.get(catalog.status, "gray")
            st.markdown(f"**Status:** <span style='color:{status_color}'>{catalog.status}</span>", unsafe_allow_html=True)
        with col4:
            st.metric("Total Checks", len(catalog.checks))
        
        st.divider()
        
        # Filter and search
        col1, col2, col3 = st.columns(3)
        with col1:
            filter_status = st.multiselect(
                "Filter by DM Status",
                ["pending_review", "approved", "rejected", "needs_revision"],
                default=["pending_review"]
            )
        with col2:
            filter_category = st.multiselect(
                "Filter by Category",
                ["timing", "missing", "sequence", "inclusion", "dose", "other"],
                default=[]
            )
        with col3:
            search_term = st.text_input("Search checks", "")
        
        # Filter checks
        filtered_checks = catalog.checks
        if filter_status:
            filtered_checks = [c for c in filtered_checks if c.dm_status in filter_status]
        if filter_category:
            filtered_checks = [c for c in filtered_checks if c.category in filter_category]
        if search_term:
            search_lower = search_term.lower()
            filtered_checks = [
                c for c in filtered_checks
                if search_lower in c.name.lower() or search_lower in c.check_id.lower()
            ]
        
        st.write(f"Showing {len(filtered_checks)} of {len(catalog.checks)} checks")
        
        # Display checks
        for check in filtered_checks:
            with st.expander(f"{check.check_id}: {check.name}", expanded=False):
                display_check_detail(check, catalog)
        
        # Bulk actions
        st.divider()
        st.subheader("Bulk Actions")
        col1, col2, col3 = st.columns(3)
        
        with col1:
            if st.button("Approve All Pending", type="primary"):
                approve_all_pending(catalog)
        
        with col2:
            if st.button("Export Approved Catalog"):
                export_approved(catalog)
        
        with col3:
            if st.button("Create New Version"):
                create_new_version(catalog)


def display_check_detail(check: PDCheck, catalog: PDCheckCatalog):
    """Display detailed view of a check with edit capabilities"""
    
    # Status badge
    status_colors = {
        "pending_review": "🟡",
        "approved": "🟢",
        "rejected": "🔴",
        "needs_revision": "🟠"
    }
    st.markdown(f"**Status:** {status_colors.get(check.dm_status, '⚪')} {check.dm_status}")
    
    # Editable fields
    col1, col2 = st.columns(2)
    
    with col1:
        new_name = st.text_input("Name", value=check.name, key=f"name_{check.check_id}")
        new_category = st.selectbox(
            "Category",
            ["timing", "missing", "sequence", "inclusion", "dose", "other"],
            index=["timing", "missing", "sequence", "inclusion", "dose", "other"].index(check.category),
            key=f"cat_{check.check_id}"
        )
        new_severity = st.selectbox(
            "Severity",
            ["critical", "major", "minor", "info"],
            index=["critical", "major", "minor", "info"].index(check.severity),
            key=f"sev_{check.check_id}"
        )
    
    with col2:
        new_dm_status = st.selectbox(
            "DM Status",
            ["pending_review", "approved", "rejected", "needs_revision"],
            index=["pending_review", "approved", "rejected", "needs_revision"].index(check.dm_status),
            key=f"status_{check.check_id}"
        )
        new_output_message = st.text_area(
            "Output Message",
            value=check.output_message,
            key=f"msg_{check.check_id}"
        )
    
    # Protocol references
    st.subheader("Protocol References")
    for i, ref in enumerate(check.protocol_refs):
        col1, col2, col3 = st.columns(3)
        with col1:
            st.text_input("Document", value=ref.doc, key=f"ref_doc_{check.check_id}_{i}", disabled=True)
        with col2:
            st.text_input("Section", value=ref.section or "", key=f"ref_sec_{check.check_id}_{i}", disabled=True)
        with col3:
            st.number_input("Page", value=ref.page or 0, key=f"ref_page_{check.check_id}_{i}", disabled=True)
    
    # Inputs
    st.subheader("Input Datasets")
    for i, inp in enumerate(check.inputs):
        col1, col2 = st.columns([1, 3])
        with col1:
            st.text_input("Dataset", value=inp.dataset, key=f"inp_ds_{check.check_id}_{i}", disabled=True)
        with col2:
            st.text_input("Columns", value=", ".join(inp.columns), key=f"inp_col_{check.check_id}_{i}", disabled=True)
    
    # Logic
    st.subheader("Logic")
    st.json(check.logic.model_dump())
    
    # DM Comments
    new_comments = st.text_area(
        "DM Comments",
        value=check.dm_comments or "",
        key=f"comments_{check.check_id}",
        placeholder="Add comments or notes about this check..."
    )
    
    # Action buttons
    col1, col2, col3, col4 = st.columns(4)
    
    with col1:
        if st.button("✅ Approve", key=f"approve_{check.check_id}"):
            update_check_status(catalog, check.check_id, "approved", new_comments)
    
    with col2:
        if st.button("❌ Reject", key=f"reject_{check.check_id}"):
            update_check_status(catalog, check.check_id, "rejected", new_comments)
    
    with col3:
        if st.button("✏️ Needs Revision", key=f"revise_{check.check_id}"):
            update_check_status(catalog, check.check_id, "needs_revision", new_comments)
    
    with col4:
        if st.button("💾 Save Changes", key=f"save_{check.check_id}"):
            # Update check with new values
            check.name = new_name
            check.category = new_category
            check.severity = new_severity
            check.dm_status = new_dm_status
            check.output_message = new_output_message
            check.dm_comments = new_comments if new_comments else None
            check.dm_reviewed_at = datetime.utcnow()
            check.dm_reviewed_by = "dm_user"  # In production, get from auth
            
            if save_catalog(catalog):
                st.success("Changes saved!")
                st.rerun()


def update_check_status(catalog: PDCheckCatalog, check_id: str, status: str, comments: str):
    """Update the status of a check"""
    for check in catalog.checks:
        if check.check_id == check_id:
            check.dm_status = status
            check.dm_comments = comments if comments else None
            check.dm_reviewed_at = datetime.utcnow()
            check.dm_reviewed_by = "dm_user"
            break
    
    # Update catalog status if all checks are reviewed
    all_reviewed = all(c.dm_status in ["approved", "rejected"] for c in catalog.checks)
    if all_reviewed:
        approved_count = sum(1 for c in catalog.checks if c.dm_status == "approved")
        if approved_count > 0:
            catalog.status = "approved"
        else:
            catalog.status = "rejected"
    
    if save_catalog(catalog):
        st.success(f"Check {check_id} {status}!")
        st.rerun()


def approve_all_pending(catalog: PDCheckCatalog):
    """Approve all pending checks"""
    updated = 0
    for check in catalog.checks:
        if check.dm_status == "pending_review":
            check.dm_status = "approved"
            check.dm_reviewed_at = datetime.utcnow()
            check.dm_reviewed_by = "dm_user"
            updated += 1
    
    if updated > 0:
        catalog.status = "approved"
        if save_catalog(catalog):
            st.success(f"Approved {updated} checks!")
            st.rerun()
    else:
        st.info("No pending checks to approve")


def export_approved(catalog: PDCheckCatalog):
    """Export only approved checks to a new catalog"""
    approved_checks = [c for c in catalog.checks if c.dm_status == "approved"]
    
    if not approved_checks:
        st.warning("No approved checks to export")
        return
    
    approved_catalog = PDCheckCatalog(
        study_id=catalog.study_id,
        version=catalog.version,
        created_at=catalog.created_at,
        created_by=catalog.created_by,
        status="approved",
        checks=approved_checks,
        metadata=catalog.metadata
    )
    
    # Download as JSON
    catalog_json = approved_catalog.model_dump(mode="json", exclude_none=True)
    st.download_button(
        label="Download Approved Catalog JSON",
        data=json.dumps(catalog_json, indent=2),
        file_name=f"{catalog.study_id}_approved_v{catalog.version}.json",
        mime="application/json"
    )


def create_new_version(catalog: PDCheckCatalog):
    """Create a new version of the catalog"""
    new_version = catalog.version + 1
    new_catalog = PDCheckCatalog(
        study_id=catalog.study_id,
        version=new_version,
        created_at=datetime.utcnow(),
        created_by="dm_user",
        status="draft",
        checks=catalog.checks.copy(),
        metadata=catalog.metadata
    )
    
    if save_catalog(new_catalog):
        st.success(f"Created version {new_version}!")
        st.rerun()


if __name__ == "__main__":
    main()

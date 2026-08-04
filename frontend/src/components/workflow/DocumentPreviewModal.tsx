import { MarkdownPreview } from "./MarkdownPreview";
import { AcrfSummaryPreview } from "./preview/AcrfSummaryPreview";
import { DeviationsPreview } from "./preview/DeviationsPreview";
import type { ExtendedDeviationPreviewRow } from "./preview/DeviationsPreview";
import { SpreadsheetPreview } from "./preview/SpreadsheetPreview";
import type { AcrfSummaryPreviewRow } from "../../utils/previewFormat";

export type DocumentPreviewKind = "markdown" | "table" | "spreadsheet" | "acrf-summary";

interface DocumentPreviewModalProps {
  open: boolean;
  title: string;
  kind: DocumentPreviewKind;
  markdownContent?: string;
  tableRows?: ExtendedDeviationPreviewRow[];
  spreadsheetColumns?: string[];
  spreadsheetRows?: Array<Record<string, string>>;
  acrfSummaryRows?: AcrfSummaryPreviewRow[];
  isLoading?: boolean;
  error?: string;
  onClose: () => void;
}

export function DocumentPreviewModal({
  open,
  title,
  kind,
  markdownContent = "",
  tableRows = [],
  spreadsheetColumns = [],
  spreadsheetRows = [],
  acrfSummaryRows = [],
  isLoading = false,
  error = "",
  onClose
}: DocumentPreviewModalProps): JSX.Element | null {
  if (!open) {
    return null;
  }

  return (
    <div className="document-preview-modal-overlay" role="presentation" onClick={onClose}>
      <div
        className="document-preview-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="document-preview-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="document-preview-modal-header">
          <h2 id="document-preview-modal-title" className="document-preview-modal-title">
            {title}
          </h2>
          <button type="button" className="button button-secondary" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="document-preview-modal-body">
          {isLoading ? <p className="step1-status">Loading preview…</p> : null}
          {error ? <p className="step1-error">{error}</p> : null}
          {!isLoading && !error && kind === "markdown" ? (
            markdownContent.trim() ? (
              <MarkdownPreview content={markdownContent} />
            ) : (
              <p className="step7-muted">No preview content available yet. Run extraction first.</p>
            )
          ) : null}
          {!isLoading && !error && kind === "table" ? (
            tableRows.length > 0 ? (
              <DeviationsPreview rows={tableRows} showExtendedColumns />
            ) : (
              <p className="step7-muted">No rows found in this specification source.</p>
            )
          ) : null}
          {!isLoading && !error && kind === "spreadsheet" ? (
            spreadsheetRows.length > 0 ? (
              <SpreadsheetPreview columns={spreadsheetColumns} rows={spreadsheetRows} />
            ) : (
              <p className="step7-muted">No rows found in this specification source.</p>
            )
          ) : null}
          {!isLoading && !error && kind === "acrf-summary" ? (
            acrfSummaryRows.length > 0 ? (
              <AcrfSummaryPreview rows={acrfSummaryRows} />
            ) : (
              <p className="step7-muted">No aCRF summary datasets found yet. Run aCRF preparation first.</p>
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}

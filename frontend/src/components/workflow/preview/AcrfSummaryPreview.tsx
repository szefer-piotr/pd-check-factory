import type { AcrfSummaryPreviewRow } from "../../../utils/previewFormat";

interface AcrfSummaryPreviewProps {
  rows: AcrfSummaryPreviewRow[];
}

export function AcrfSummaryPreview({ rows }: AcrfSummaryPreviewProps): JSX.Element {
  if (rows.length === 0) {
    return <p className="preview-empty">No aCRF summary datasets found in preview.</p>;
  }

  return (
    <div className="preview-table-wrap preview-table-wrap-wide">
      <table className="preview-table preview-table-spreadsheet">
        <thead>
          <tr>
            <th>Dataset</th>
            <th>Column</th>
            <th>Description</th>
            <th>Values</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.dataset_name}-${row.column_name}-${index}`}>
              <td>{row.dataset_name}</td>
              <td>{row.column_name || "—"}</td>
              <td>{row.column_description || "—"}</td>
              <td>{row.column_values || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

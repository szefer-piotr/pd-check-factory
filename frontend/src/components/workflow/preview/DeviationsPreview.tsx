import type { DeviationPreviewRow } from "../../../utils/previewFormat";

interface DeviationsPreviewProps {
  rows: DeviationPreviewRow[];
}

export function DeviationsPreview({ rows }: DeviationsPreviewProps): JSX.Element {
  if (rows.length === 0) {
    return <p className="preview-empty">No deviations found in preview.</p>;
  }

  return (
    <div className="preview-table-wrap">
      <table className="preview-table">
        <thead>
          <tr>
            <th>Deviation ID</th>
            <th>Rule ID</th>
            <th>Text</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.deviation_id}>
              <td>{row.deviation_id}</td>
              <td>{row.rule_id || "—"}</td>
              <td>{row.text || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

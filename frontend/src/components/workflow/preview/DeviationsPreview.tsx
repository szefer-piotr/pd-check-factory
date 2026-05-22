import type { DeviationPreviewRow } from "../../../utils/previewFormat";

export interface ExtendedDeviationPreviewRow extends DeviationPreviewRow {
  deviation_text?: string;
  rule_title?: string;
  entry_source?: string;
  status?: string;
}

interface DeviationsPreviewProps {
  rows: ExtendedDeviationPreviewRow[];
  showExtendedColumns?: boolean;
}

export function DeviationsPreview({ rows, showExtendedColumns = false }: DeviationsPreviewProps): JSX.Element {
  if (rows.length === 0) {
    return <p className="preview-empty">No deviations found in preview.</p>;
  }

  return (
    <div className="preview-table-wrap">
      <table className="preview-table">
        <thead>
          <tr>
            <th>Deviation ID</th>
            {showExtendedColumns ? <th>Rule title</th> : null}
            <th>Rule ID</th>
            <th>Text</th>
            {showExtendedColumns ? (
              <>
                <th>Source</th>
                <th>Status</th>
              </>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.deviation_id}>
              <td>{row.deviation_id}</td>
              {showExtendedColumns ? <td>{row.rule_title || "—"}</td> : null}
              <td>{row.rule_id || "—"}</td>
              <td>{row.text || row.deviation_text || "—"}</td>
              {showExtendedColumns ? (
                <>
                  <td>{row.entry_source || "—"}</td>
                  <td>{row.status || "—"}</td>
                </>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

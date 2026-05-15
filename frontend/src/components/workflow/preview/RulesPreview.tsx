import type { RulePreviewRow } from "../../../utils/previewFormat";

interface RulesPreviewProps {
  rows: RulePreviewRow[];
}

export function RulesPreview({ rows }: RulesPreviewProps): JSX.Element {
  if (rows.length === 0) {
    return <p className="preview-empty">No rules found in preview.</p>;
  }

  return (
    <div className="preview-table-wrap">
      <table className="preview-table">
        <thead>
          <tr>
            <th>Rule ID</th>
            <th>Title</th>
            <th>Text</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.rule_id}>
              <td>{row.rule_id}</td>
              <td>{row.title || "—"}</td>
              <td>{row.text || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

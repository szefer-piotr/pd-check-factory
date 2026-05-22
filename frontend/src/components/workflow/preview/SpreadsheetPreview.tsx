interface SpreadsheetPreviewProps {
  columns: string[];
  rows: Array<Record<string, string>>;
}

export function SpreadsheetPreview({ columns, rows }: SpreadsheetPreviewProps): JSX.Element {
  if (rows.length === 0) {
    return <p className="preview-empty">No rows found in preview.</p>;
  }

  const displayColumns = columns.length > 0 ? columns : Object.keys(rows[0] ?? {});

  return (
    <div className="preview-table-wrap preview-table-wrap-wide">
      <table className="preview-table preview-table-spreadsheet">
        <thead>
          <tr>
            {displayColumns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`row-${rowIndex}`}>
              {displayColumns.map((column) => (
                <td key={`${rowIndex}-${column}`}>{row[column] || "—"}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

import { useCallback, useEffect, useState } from "react";
import { fetchSpecificationsPreview, type SpecificationPreviewSource } from "../../services/stepApi";
import { isDeviationPreviewRow, isSpreadsheetPreviewSource } from "../../utils/specificationPreview";
import { DeviationsPreview } from "./preview/DeviationsPreview";
import type { ExtendedDeviationPreviewRow } from "./preview/DeviationsPreview";
import { SpreadsheetPreview } from "./preview/SpreadsheetPreview";

interface SpecificationPreviewPanelProps {
  studyId: string;
}

function toDeviationPreviewRows(source: SpecificationPreviewSource | undefined): ExtendedDeviationPreviewRow[] {
  if (!source || isSpreadsheetPreviewSource(source)) {
    return [];
  }
  return source.rows.filter(isDeviationPreviewRow).map((row) => ({
    deviation_id: row.deviation_id,
    rule_id: row.rule_id,
    text: row.deviation_text || row.text || "",
    rule_title: row.rule_title,
    entry_source: row.entry_source,
    status: row.status
  }));
}

export function SpecificationPreviewPanel({ studyId }: SpecificationPreviewPanelProps): JSX.Element {
  const [sources, setSources] = useState<SpecificationPreviewSource[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const loadSources = useCallback(async (): Promise<void> => {
    const trimmed = studyId.trim();
    if (!trimmed) {
      setSources([]);
      setSelectedKey("");
      return;
    }
    setIsLoading(true);
    setError("");
    try {
      const response = await fetchSpecificationsPreview(trimmed);
      setSources(response.sources);
      setSelectedKey((current) => {
        if (current && response.sources.some((source) => source.key === current)) {
          return current;
        }
        return response.sources[0]?.key ?? "";
      });
    } catch (loadError) {
      setSources([]);
      setSelectedKey("");
      setError(loadError instanceof Error ? loadError.message : "Unable to load specification preview.");
    } finally {
      setIsLoading(false);
    }
  }, [studyId]);

  useEffect(() => {
    void loadSources();
  }, [loadSources]);

  const selectedSource = sources.find((source) => source.key === selectedKey);
  const deviationRows = toDeviationPreviewRows(selectedSource);
  const spreadsheetSource = isSpreadsheetPreviewSource(selectedSource) ? selectedSource : null;

  return (
    <section className="specification-preview-panel" aria-label="Specification preview">
      <h3 className="study-pipeline-stage-title">Specification preview</h3>
      <p className="step7-muted">
        Compare imported PD Specifications rows with generated or grounded deviations using the same review format.
      </p>

      {isLoading ? <p className="step1-status">Loading specification sources…</p> : null}
      {error ? <p className="step1-error">{error}</p> : null}

      {sources.length > 0 ? (
        <label className="control-group" htmlFor="spec-preview-source">
          <span className="control-label">Preview source</span>
          <select
            id="spec-preview-source"
            className="input"
            value={selectedKey}
            onChange={(event) => setSelectedKey(event.target.value)}
          >
            {sources.map((source) => (
              <option key={source.key} value={source.key}>
                {source.label} ({source.rows.length} rows)
              </option>
            ))}
          </select>
        </label>
      ) : !isLoading && !error ? (
        <p className="step7-muted">No specification sources available yet. Upload a PD workbook or run extraction/import.</p>
      ) : null}

      {spreadsheetSource ? (
        <SpreadsheetPreview columns={spreadsheetSource.columns} rows={spreadsheetSource.rows} />
      ) : selectedSource ? (
        <DeviationsPreview rows={deviationRows} showExtendedColumns />
      ) : null}
    </section>
  );
}

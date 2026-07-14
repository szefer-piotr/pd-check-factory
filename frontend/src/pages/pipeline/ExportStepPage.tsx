import { useEffect, useState } from "react";
import { Card } from "../../components/layout/Card";
import { Stack } from "../../components/layout/Stack";
import {
  exportStep7DeviationsCodingCsv,
  fetchStep7Deviations,
  type Step7DeviationRow
} from "../../services/stepApi";

interface ExportStepPageProps {
  studyId: string;
}

export function ExportStepPage({ studyId }: ExportStepPageProps): JSX.Element {
  const [rows, setRows] = useState<Step7DeviationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!studyId.trim()) {
      setRows([]);
      return;
    }
    let cancelled = false;
    async function load(): Promise<void> {
      setLoading(true);
      setError("");
      try {
        const result = await fetchStep7Deviations(studyId.trim(), "generated");
        if (!cancelled) {
          setRows(result.rows);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load deviations.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [studyId]);

  const acceptedCount = rows.filter((row) => row.status === "accepted").length;

  async function handleExport(): Promise<void> {
    if (!studyId.trim()) {
      return;
    }
    setExporting(true);
    setError("");
    setMessage("");
    try {
      const result = await exportStep7DeviationsCodingCsv(studyId.trim(), "generated");
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.fileName;
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage(`Downloaded ${result.fileName} (${acceptedCount} accepted deviation${acceptedCount === 1 ? "" : "s"}).`);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <Stack gap="md">
      <div className="pipeline-step-page">
      <header className="pipeline-step-header">
        <div>
          <h1>Export CSV</h1>
          <p className="pipeline-step-description">
            Download accepted deviations as company PD Specifications CSV (13 columns, NAL00-107 format).
          </p>
        </div>
      </header>

      {error ? <p className="pipeline-error">{error}</p> : null}
      {message ? <p className="pipeline-message">{message}</p> : null}

      <Card>
        {loading ? <p>Loading deviation counts…</p> : null}
        {!loading ? (
          <Stack gap="sm">
            <p>
              Total deviations: <strong>{rows.length}</strong>
            </p>
            <p>
              Accepted (included in export): <strong>{acceptedCount}</strong>
            </p>
            {acceptedCount === 0 ? (
              <p className="pipeline-hint">Accept deviations in the Review step before exporting.</p>
            ) : null}
            <button type="button" disabled={exporting || acceptedCount === 0} onClick={() => void handleExport()}>
              Download CSV
            </button>
          </Stack>
        ) : null}
      </Card>
      </div>
    </Stack>
  );
}

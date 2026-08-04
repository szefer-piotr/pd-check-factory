import { useEffect, useState } from "react";
import { Card } from "../../components/layout/Card";
import { Stack } from "../../components/layout/Stack";
import { Step7ReviewPanel } from "../../components/workflow/Step7ReviewPanel";
import {
  exportStep7DeviationsCodingCsv,
  fetchStep7Deviations,
  setStep7ReviewDisplaySource,
  type OpenAiDeploymentOption,
  type Step7DeviationRow,
  type StepStatus
} from "../../services/stepApi";

interface ReviewStepPageProps {
  studyId: string;
  onStatusesChange: (statuses: Record<string, StepStatus>) => void;
  llmDeployments: OpenAiDeploymentOption[];
  deploymentsLoading: boolean;
  chatDeployment: string;
  onChatDeploymentChange: (value: string) => void;
}

export function ReviewStepPage({
  studyId,
  onStatusesChange,
  llmDeployments,
  deploymentsLoading,
  chatDeployment,
  onChatDeploymentChange
}: ReviewStepPageProps): JSX.Element {
  const [ready, setReady] = useState(false);
  const [rows, setRows] = useState<Step7DeviationRow[]>([]);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [exportMessage, setExportMessage] = useState("");

  useEffect(() => {
    if (!studyId.trim()) {
      return;
    }
    void setStep7ReviewDisplaySource(studyId.trim(), "generated").then(() => setReady(true));
  }, [studyId]);

  useEffect(() => {
    if (!studyId.trim() || !ready) {
      setRows([]);
      return;
    }
    let cancelled = false;
    void fetchStep7Deviations(studyId.trim(), "generated")
      .then((result) => {
        if (!cancelled) {
          setRows(result.rows);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRows([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ready, studyId]);

  const acceptedCount = rows.filter((row) => row.status === "accepted").length;

  async function handleExport(): Promise<void> {
    if (!studyId.trim()) {
      return;
    }
    setExporting(true);
    setExportError("");
    setExportMessage("");
    try {
      const result = await exportStep7DeviationsCodingCsv(studyId.trim(), "generated");
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.fileName;
      anchor.click();
      URL.revokeObjectURL(url);
      setExportMessage(
        `Downloaded ${result.fileName} (${acceptedCount} accepted deviation${acceptedCount === 1 ? "" : "s"}).`
      );
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <Stack gap="md">
      <div className="pipeline-step-page pipeline-review-page">
        <header className="pipeline-step-header">
          <div>
            <h1>Review deviations</h1>
            <p className="pipeline-step-description">
              Discuss individual deviations with the assistant, then export the current accepted set.
            </p>
          </div>
        </header>

        <Card>
          <Stack gap="sm">
            <h2 className="study-setup-section-head" style={{ margin: 0 }}>
              Export
            </h2>
            <p>
              Accepted (included in CSV): <strong>{acceptedCount}</strong> / {rows.length}
            </p>
            {exportError ? <p className="pipeline-error">{exportError}</p> : null}
            {exportMessage ? <p className="pipeline-message">{exportMessage}</p> : null}
            {acceptedCount === 0 ? (
              <p className="pipeline-hint">Accept deviations below before exporting.</p>
            ) : null}
            <button
              type="button"
              className="button button-primary"
              disabled={exporting || acceptedCount === 0}
              onClick={() => void handleExport()}
            >
              {exporting ? (
                <>
                  <span className="spinner spinner-sm" aria-hidden />
                  Exporting…
                </>
              ) : (
                "Download company PD Specs CSV"
              )}
            </button>
          </Stack>
        </Card>

        {ready ? (
          <Step7ReviewPanel
            studyId={studyId}
            onStepStatusesChange={(statuses) => {
              onStatusesChange(statuses);
              void fetchStep7Deviations(studyId.trim(), "generated").then((result) => setRows(result.rows));
            }}
            llmDeployments={llmDeployments}
            deploymentsLoading={deploymentsLoading}
            chatDeployment={chatDeployment}
            onChatDeploymentChange={onChatDeploymentChange}
            hideSourceSelector
            minimal
          />
        ) : (
          <p>Loading review data…</p>
        )}
      </div>
    </Stack>
  );
}

import { useCallback, useEffect, useState } from "react";
import { Stack } from "../../components/layout/Stack";
import { Step7ReviewPanel } from "../../components/workflow/Step7ReviewPanel";
import {
  exportStep7DeviationsCodingCsv,
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
      setReady(false);
      return;
    }
    let cancelled = false;
    setReady(false);
    void setStep7ReviewDisplaySource(studyId.trim(), "generated")
      .then(() => {
        if (!cancelled) {
          setReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [studyId]);

  const handleRowsChange = useCallback((nextRows: Step7DeviationRow[]) => {
    setRows(nextRows);
  }, []);

  const handleStatusesChange = useCallback(
    (statuses: Record<string, StepStatus>) => {
      onStatusesChange(statuses);
    },
    [onStatusesChange]
  );

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

        {exportError ? <p className="pipeline-error">{exportError}</p> : null}
        {exportMessage ? <p className="pipeline-message">{exportMessage}</p> : null}

        {ready ? (
          <Step7ReviewPanel
            studyId={studyId}
            onStepStatusesChange={handleStatusesChange}
            onRowsChange={handleRowsChange}
            llmDeployments={llmDeployments}
            deploymentsLoading={deploymentsLoading}
            chatDeployment={chatDeployment}
            onChatDeploymentChange={onChatDeploymentChange}
            hideSourceSelector
            minimal
            exportAcceptedCount={acceptedCount}
            exportTotalCount={rows.length}
            exporting={exporting}
            onExport={() => void handleExport()}
          />
        ) : (
          <p className="step7-muted">Loading review data…</p>
        )}
      </div>
    </Stack>
  );
}

import { useEffect, useState } from "react";
import { Stack } from "../../components/layout/Stack";
import { Step7ReviewPanel } from "../../components/workflow/Step7ReviewPanel";
import { setStep7ReviewDisplaySource, type OpenAiDeploymentOption, type StepStatus } from "../../services/stepApi";

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

  useEffect(() => {
    if (!studyId.trim()) {
      return;
    }
    void setStep7ReviewDisplaySource(studyId.trim(), "generated").then(() => setReady(true));
  }, [studyId]);

  return (
    <Stack gap="md">
      <div className="pipeline-step-page pipeline-review-page">
      <header className="pipeline-step-header">
        <div>
          <h1>Review deviations</h1>
          <p className="pipeline-step-description">
            Discuss individual deviations with the assistant. Your chat history is saved on the server.
          </p>
        </div>
      </header>
      {ready ? (
        <Step7ReviewPanel
          studyId={studyId}
          onStepStatusesChange={onStatusesChange}
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

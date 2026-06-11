import { useEffect } from "react";
import { Step7ReviewPanel } from "../../components/workflow/Step7ReviewPanel";
import { reviewSourceForWorkflow, type WorkflowChoice } from "../../data/wizardSteps";
import type { OpenAiDeploymentOption, StepStatus } from "../../services/stepApi";
import { setStep7ReviewDisplaySource } from "../../services/stepApi";

interface ReviewPageProps {
  studyId: string;
  workflow: WorkflowChoice | null;
  onStepStatusesChange: (statuses: Record<string, StepStatus>) => void;
  llmDeployments: OpenAiDeploymentOption[];
  deploymentsLoading: boolean;
  chatDeployment: string;
  onChatDeploymentChange: (value: string) => void;
}

export function ReviewPage({
  studyId,
  workflow,
  onStepStatusesChange,
  llmDeployments,
  deploymentsLoading,
  chatDeployment,
  onChatDeploymentChange
}: ReviewPageProps): JSX.Element {
  useEffect(() => {
    const trimmed = studyId.trim();
    if (!trimmed || !workflow) {
      return;
    }
    void setStep7ReviewDisplaySource(trimmed, reviewSourceForWorkflow(workflow));
  }, [studyId, workflow]);

  return (
    <section className="wizard-review" aria-label="Review and finalize">
      <h2>Review &amp; Finalize</h2>
      <Step7ReviewPanel
        studyId={studyId}
        onStepStatusesChange={onStepStatusesChange}
        llmDeployments={llmDeployments}
        deploymentsLoading={deploymentsLoading}
        chatDeployment={chatDeployment}
        onChatDeploymentChange={onChatDeploymentChange}
        hideSourceSelector
      />
    </section>
  );
}

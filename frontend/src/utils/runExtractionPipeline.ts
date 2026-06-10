import {
  fetchStepStatuses,
  runStep,
  runStep1Extraction,
  type Step1DocumentExtractor,
  type StepStatus,
  type StudyWorkflow
} from "../services/stepApi";
import { getWorkflowSteps, PROCESSING_SUB_STEPS } from "./processingSteps";

const PROCESSING_STEP_SET = new Set<string>(PROCESSING_SUB_STEPS);

export interface RunExtractionOptions {
  studyId: string;
  workflow?: StudyWorkflow | null;
  protocolExtractor: Step1DocumentExtractor;
  acrfExtractor: Step1DocumentExtractor;
  extractionDeployment?: string;
  acrfSummaryDeployment?: string;
  extractionLlmInstructions?: string;
  force?: boolean;
  fromStepId?: string | null;
  stepIds?: string[];
  onStepStart?: (stepId: string) => void;
  onStatusesChange?: (statuses: Record<string, StepStatus>) => void;
  shouldAbort?: () => boolean;
}

function resolveStepIds(workflow: StudyWorkflow | null | undefined, stepIds?: string[]): string[] {
  if (stepIds && stepIds.length > 0) {
    return stepIds;
  }
  return getWorkflowSteps(workflow).filter((stepId) => stepId !== "review-and-finalize");
}

export async function runExtractionPipeline({
  studyId,
  workflow = "extract",
  protocolExtractor,
  acrfExtractor,
  extractionDeployment,
  acrfSummaryDeployment,
  extractionLlmInstructions = "",
  force = false,
  fromStepId = null,
  stepIds,
  onStepStart,
  onStatusesChange,
  shouldAbort
}: RunExtractionOptions): Promise<Record<string, StepStatus>> {
  const trimmedStudyId = studyId.trim();
  const orderedSteps = resolveStepIds(workflow, stepIds);
  const statusResponse = await fetchStepStatuses(trimmedStudyId);
  let stepStatuses = Object.fromEntries(
    statusResponse.steps.map((step) => [step.stepId, step.status])
  ) as Record<string, StepStatus>;

  let started = !fromStepId;
  for (const stepId of orderedSteps) {
    if (shouldAbort?.()) {
      break;
    }
    if (!started) {
      if (stepId === fromStepId) {
        started = true;
      } else {
        continue;
      }
    }

    const alreadyDone = !force && (stepStatuses[stepId] === "done" || stepStatuses[stepId] === "skipped");
    if (alreadyDone) {
      continue;
    }
    onStepStart?.(stepId);

    if (stepId === "extract-inputs") {
      const extract = await runStep1Extraction(trimmedStudyId, {
        protocolExtractor,
        acrfExtractor,
        force
      });
      stepStatuses = extract.stepStatuses;
    } else if (PROCESSING_STEP_SET.has(stepId)) {
      const runOpts =
        stepId === "extract-rules" || stepId === "extract-deviations"
          ? {
              llmInstructions: extractionLlmInstructions,
              llmDeployment: extractionDeployment || undefined,
              force
            }
          : stepId === "acrf-summary-text"
            ? {
                llmDeployment: acrfSummaryDeployment || undefined,
                force
              }
            : { force };
      const response = await runStep(trimmedStudyId, stepId, runOpts);
      stepStatuses = response.stepStatuses;
    } else {
      const response = await runStep(trimmedStudyId, stepId, {
        llmDeployment: extractionDeployment || undefined,
        force
      });
      stepStatuses = response.stepStatuses;
    }
    onStatusesChange?.(stepStatuses);
  }

  const finalStatus = await fetchStepStatuses(trimmedStudyId);
  const normalized = Object.fromEntries(
    finalStatus.steps.map((step) => [step.stepId, step.status])
  ) as Record<string, StepStatus>;
  onStatusesChange?.(normalized);
  return normalized;
}

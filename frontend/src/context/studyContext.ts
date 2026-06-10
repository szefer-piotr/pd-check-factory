import { createContext } from "react";
import type { StudySummaryResponse } from "../services/stepApi";

export interface PipelineRunnerApi {
  isRunning: boolean;
  activeStepId: string | null;
  lastError: string;
  autoResumeEnabled: boolean;
  startPipeline: () => Promise<void>;
  runRemaining: () => Promise<void>;
  runSingleStep: (stepId: string, options?: { force?: boolean }) => Promise<void>;
  finalize: () => Promise<void>;
  clearError: () => void;
}

export interface StudyContextValue {
  studyId: string;
  summary: StudySummaryResponse | null;
  isLoading: boolean;
  error: string;
  refresh: () => Promise<void>;
  pipelineRunner: PipelineRunnerApi;
}

export const StudyContext = createContext<StudyContextValue | null>(null);

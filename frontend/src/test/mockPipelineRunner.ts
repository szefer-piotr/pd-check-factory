import { vi } from "vitest";
import type { PipelineRunnerApi } from "../context/studyContext";

export function createMockPipelineRunner(
  overrides: Partial<PipelineRunnerApi> = {}
): PipelineRunnerApi {
  return {
    isRunning: false,
    activeStepId: null,
    lastError: "",
    autoResumeEnabled: false,
    startPipeline: vi.fn(async () => undefined),
    runRemaining: vi.fn(async () => undefined),
    runSingleStep: vi.fn(async () => undefined),
    finalize: vi.fn(async () => undefined),
    clearError: vi.fn(),
    ...overrides
  };
}

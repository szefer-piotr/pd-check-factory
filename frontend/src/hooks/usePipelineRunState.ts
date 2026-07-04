import { useCallback, useEffect, useState } from "react";
import { fetchStep1RunState, type Step1RunStateResponse } from "../services/stepApi";

const DEFAULT_STATE: Step1RunStateResponse = {
  studyId: "",
  status: "idle",
  currentStage: "",
  currentSubStepId: "",
  message: "",
  error: "",
  startedAt: "",
  finishedAt: "",
  logs: [],
  llmProgress: null,
  progress: null
};

export function usePipelineRunState(
  studyId: string,
  options: { enabled?: boolean; pollMs?: number } = {}
): {
  runState: Step1RunStateResponse;
  refresh: () => Promise<void>;
} {
  const { enabled = true, pollMs = 1500 } = options;
  const [runState, setRunState] = useState<Step1RunStateResponse>(DEFAULT_STATE);

  const refresh = useCallback(async (): Promise<void> => {
    const trimmed = studyId.trim();
    if (!trimmed) {
      setRunState(DEFAULT_STATE);
      return;
    }
    try {
      const response = await fetchStep1RunState(trimmed);
      setRunState(response);
    } catch {
      // best-effort polling
    }
  }, [studyId]);

  useEffect(() => {
    if (!enabled || !studyId.trim()) {
      setRunState(DEFAULT_STATE);
      return;
    }
    void refresh();
    if (pollMs <= 0) {
      return;
    }
    const timer = window.setInterval(() => void refresh(), pollMs);
    return () => window.clearInterval(timer);
  }, [enabled, pollMs, refresh, studyId]);

  return { runState, refresh };
}

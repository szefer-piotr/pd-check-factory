import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { usePipelineRunState } from "../hooks/usePipelineRunState";
import {
  preprocessAcrf,
  preprocessProtocol,
  runStep,
  type LlmProgress,
  type PipelineLogLine,
  type StepStatus
} from "../services/stepApi";

export type PipelineJobKind =
  | "preprocess-protocol"
  | "preprocess-acrf"
  | "run:extract-rules"
  | "run:extract-deviations"
  | "run:dedupe-deviations";

export type ToastTone = "info" | "success" | "error";

export interface ToastItem {
  id: string;
  tone: ToastTone;
  title: string;
  detail?: string;
}

export interface PipelineJobSpec {
  kind: PipelineJobKind;
  studyId: string;
  label: string;
  run: () => Promise<void>;
}

interface PipelineJobContextValue {
  studyId: string;
  setStudyId: (value: string) => void;
  isRunActive: boolean;
  activeJobLabel: string;
  queueLength: number;
  logs: PipelineLogLine[];
  llmProgress: LlmProgress | null;
  runStateStatus: string;
  activityOpen: boolean;
  setActivityOpen: (open: boolean) => void;
  toasts: ToastItem[];
  dismissToast: (id: string) => void;
  enqueueJob: (spec: PipelineJobSpec) => void;
  runPreprocessProtocol: (studyId: string, force?: boolean) => Promise<void>;
  runPreprocessAcrf: (studyId: string, force?: boolean) => Promise<void>;
  runBackendStep: (
    studyId: string,
    stepId: "extract-rules" | "extract-deviations",
    options?: {
      llmDeployment?: string;
      llmInstructions?: string;
      versionMode?: "new" | "overwrite";
      overwriteVersion?: string;
    }
  ) => Promise<Record<string, StepStatus> | undefined>;
}

const PipelineJobContext = createContext<PipelineJobContextValue | null>(null);

function toastId(): string {
  return `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function PipelineJobProvider({ children }: { children: ReactNode }): JSX.Element {
  const [studyId, setStudyId] = useState("");
  const [activityOpen, setActivityOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [isRunActive, setIsRunActive] = useState(false);
  const [activeJobLabel, setActiveJobLabel] = useState("");
  const [queueLength, setQueueLength] = useState(0);
  const queueRef = useRef<PipelineJobSpec[]>([]);
  const drainingRef = useRef(false);

  const { runState } = usePipelineRunState(studyId, {
    enabled: Boolean(studyId.trim()) && (isRunActive || activityOpen),
    pollMs: 1500
  });

  const pushToast = useCallback((tone: ToastTone, title: string, detail?: string): void => {
    const id = toastId();
    setToasts((prev) => [...prev, { id, tone, title, detail }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, 6000);
  }, []);

  const dismissToast = useCallback((id: string): void => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const drainQueue = useCallback(async (): Promise<void> => {
    if (drainingRef.current) {
      return;
    }
    drainingRef.current = true;
    setIsRunActive(true);
    try {
      while (queueRef.current.length > 0) {
        const next = queueRef.current.shift()!;
        setQueueLength(queueRef.current.length);
        setActiveJobLabel(next.label);
        setActivityOpen(true);
        try {
          await next.run();
          pushToast("success", `${next.label} finished`);
        } catch (error) {
          const detail = error instanceof Error ? error.message : "Job failed";
          pushToast("error", `${next.label} failed`, detail);
          throw error;
        }
      }
    } finally {
      setActiveJobLabel("");
      setIsRunActive(false);
      setQueueLength(queueRef.current.length);
      drainingRef.current = false;
    }
  }, [pushToast]);

  const enqueueJob = useCallback(
    (spec: PipelineJobSpec): void => {
      queueRef.current.push(spec);
      setQueueLength(queueRef.current.length);
      setActivityOpen(true);
      void drainQueue().catch(() => {
        /* toast already emitted */
      });
    },
    [drainQueue]
  );

  const runPreprocessProtocol = useCallback(
    async (id: string, force = true): Promise<void> => {
      return new Promise((resolve, reject) => {
        enqueueJob({
          kind: "preprocess-protocol",
          studyId: id,
          label: "Protocol extraction",
          run: async () => {
            try {
              await preprocessProtocol(id.trim(), { force });
              resolve();
            } catch (error) {
              reject(error);
              throw error;
            }
          }
        });
      });
    },
    [enqueueJob]
  );

  const runPreprocessAcrf = useCallback(
    async (id: string, force = true): Promise<void> => {
      return new Promise((resolve, reject) => {
        enqueueJob({
          kind: "preprocess-acrf",
          studyId: id,
          label: "aCRF extraction",
          run: async () => {
            try {
              await preprocessAcrf(id.trim(), { force });
              resolve();
            } catch (error) {
              reject(error);
              throw error;
            }
          }
        });
      });
    },
    [enqueueJob]
  );

  const runBackendStep = useCallback(
    async (
      id: string,
      stepId: "extract-rules" | "extract-deviations",
      options?: {
        llmDeployment?: string;
        llmInstructions?: string;
        versionMode?: "new" | "overwrite";
        overwriteVersion?: string;
      }
    ): Promise<Record<string, StepStatus> | undefined> => {
      return new Promise((resolve, reject) => {
        enqueueJob({
          kind: stepId === "extract-rules" ? "run:extract-rules" : "run:extract-deviations",
          studyId: id,
          label: stepId === "extract-rules" ? "Extract rules" : "Extract deviations",
          run: async () => {
            try {
              const result = await runStep(id.trim(), stepId, {
                llmDeployment: options?.llmDeployment,
                llmInstructions: options?.llmInstructions,
                versionMode: options?.versionMode,
                overwriteVersion: options?.overwriteVersion
              });
              resolve(result.stepStatuses as Record<string, StepStatus>);
            } catch (error) {
              reject(error);
              throw error;
            }
          }
        });
      });
    },
    [enqueueJob]
  );

  const value = useMemo<PipelineJobContextValue>(
    () => ({
      studyId,
      setStudyId,
      isRunActive,
      activeJobLabel,
      queueLength,
      logs: runState.logs ?? [],
      llmProgress: runState.llmProgress ?? null,
      runStateStatus: runState.status,
      activityOpen,
      setActivityOpen,
      toasts,
      dismissToast,
      enqueueJob,
      runPreprocessProtocol,
      runPreprocessAcrf,
      runBackendStep
    }),
    [
      activeJobLabel,
      activityOpen,
      dismissToast,
      enqueueJob,
      isRunActive,
      queueLength,
      runBackendStep,
      runPreprocessAcrf,
      runPreprocessProtocol,
      runState.llmProgress,
      runState.logs,
      runState.status,
      studyId,
      toasts
    ]
  );

  return <PipelineJobContext.Provider value={value}>{children}</PipelineJobContext.Provider>;
}

export function usePipelineJobs(): PipelineJobContextValue {
  const ctx = useContext(PipelineJobContext);
  if (!ctx) {
    throw new Error("usePipelineJobs must be used within PipelineJobProvider");
  }
  return ctx;
}

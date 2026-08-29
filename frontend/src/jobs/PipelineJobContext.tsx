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
  defaultNavSnapshot,
  EMPTY_PROTOCOL_FOCUS,
  type ArtifactVersionsSnapshot,
  type InspectorTab,
  type PipelineNavSnapshot,
  type ProtocolFocus
} from "../pipeline/pipelineNav";
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
  inspectorTab: InspectorTab;
  setInspectorTab: (tab: InspectorTab) => void;
  openInspector: (tab?: InspectorTab) => void;
  protocolFocus: ProtocolFocus;
  setProtocolFocus: (focus: ProtocolFocus) => void;
  acrfFocusHint: string;
  setAcrfFocusHint: (hint: string) => void;
  artifactVersions: ArtifactVersionsSnapshot | null;
  setArtifactVersions: (snapshot: ArtifactVersionsSnapshot | null) => void;
  nav: PipelineNavSnapshot;
  setNav: (snapshot: PipelineNavSnapshot) => void;
  resetConfirmOpen: boolean;
  isResetting: boolean;
  requestResetStudy: () => void;
  cancelResetStudy: () => void;
  confirmResetStudy: () => Promise<void>;
  registerResetHandler: (handler: (() => Promise<void>) | null) => void;
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
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("activity");
  const [protocolFocus, setProtocolFocus] = useState<ProtocolFocus>(EMPTY_PROTOCOL_FOCUS);
  const [acrfFocusHint, setAcrfFocusHint] = useState("");
  const [artifactVersions, setArtifactVersions] = useState<ArtifactVersionsSnapshot | null>(null);
  const [nav, setNav] = useState<PipelineNavSnapshot>(defaultNavSnapshot);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const resetHandlerRef = useRef<(() => Promise<void>) | null>(null);
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

  const openInspector = useCallback((tab: InspectorTab = "activity"): void => {
    setInspectorTab(tab);
    setActivityOpen(true);
  }, []);

  const registerResetHandler = useCallback((handler: (() => Promise<void>) | null): void => {
    resetHandlerRef.current = handler;
  }, []);

  const requestResetStudy = useCallback((): void => {
    if (!studyId.trim()) {
      return;
    }
    setResetConfirmOpen(true);
  }, [studyId]);

  const cancelResetStudy = useCallback((): void => {
    if (isResetting) {
      return;
    }
    setResetConfirmOpen(false);
  }, [isResetting]);

  const confirmResetStudy = useCallback(async (): Promise<void> => {
    if (!resetHandlerRef.current) {
      setResetConfirmOpen(false);
      return;
    }
    setIsResetting(true);
    try {
      await resetHandlerRef.current();
      setResetConfirmOpen(false);
    } finally {
      setIsResetting(false);
    }
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
        openInspector("activity");
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
  }, [openInspector, pushToast]);

  const enqueueJob = useCallback(
    (spec: PipelineJobSpec): void => {
      queueRef.current.push(spec);
      setQueueLength(queueRef.current.length);
      openInspector("activity");
      void drainQueue().catch(() => {
        /* toast already emitted */
      });
    },
    [drainQueue, openInspector]
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
      inspectorTab,
      setInspectorTab,
      openInspector,
      protocolFocus,
      setProtocolFocus,
      acrfFocusHint,
      setAcrfFocusHint,
      artifactVersions,
      setArtifactVersions,
      nav,
      setNav,
      resetConfirmOpen,
      isResetting,
      requestResetStudy,
      cancelResetStudy,
      confirmResetStudy,
      registerResetHandler,
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
      acrfFocusHint,
      artifactVersions,
      cancelResetStudy,
      confirmResetStudy,
      dismissToast,
      enqueueJob,
      inspectorTab,
      isResetting,
      isRunActive,
      nav,
      openInspector,
      protocolFocus,
      queueLength,
      registerResetHandler,
      requestResetStudy,
      resetConfirmOpen,
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

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  fetchStep1RunState,
  fetchStep1UploadStatus,
  type PipelineLogLine,
  type Step1UploadStatusResponse,
  type StepStatus
} from "../services/stepApi";

export type UploadSlotStatus = "missing" | "selected" | "uploading" | "uploaded" | "error";
export type PreprocessStatus = "idle" | "running" | "done" | "failed";

export interface DocumentUploadState {
  status: UploadSlotStatus;
  originalFileName?: string;
  sizeBytes?: number;
  blobPath?: string;
  error?: string;
}

export interface ExtractionRunState {
  status: "idle" | "running" | "done" | "failed";
  currentStage: string;
  currentSubStepId: string;
  message: string;
  error: string;
  logs: PipelineLogLine[];
}

export interface StudyPipelineState {
  uploads: { protocol: DocumentUploadState; acrf: DocumentUploadState; pdSpec: DocumentUploadState };
  bothUploaded: boolean;
  allThreeUploaded: boolean;
  preprocess: { protocol: PreprocessStatus; acrf: PreprocessStatus };
  extraction: ExtractionRunState;
}

const SESSION_PREFIX = "pd-pipeline:";

function defaultUploadState(): DocumentUploadState {
  return { status: "missing" };
}

function defaultExtractionState(): ExtractionRunState {
  return {
    status: "idle",
    currentStage: "",
    currentSubStepId: "",
    message: "",
    error: "",
    logs: []
  };
}

function defaultPipelineState(): StudyPipelineState {
  return {
    uploads: { protocol: defaultUploadState(), acrf: defaultUploadState(), pdSpec: defaultUploadState() },
    bothUploaded: false,
    allThreeUploaded: false,
    preprocess: { protocol: "idle", acrf: "idle" },
    extraction: defaultExtractionState()
  };
}

function uploadStateFromApi(slot: Step1UploadStatusResponse["protocol"]): DocumentUploadState {
  if (!slot.uploaded) {
    return { status: "missing", blobPath: slot.blob };
  }
  return {
    status: "uploaded",
    originalFileName: slot.fileName,
    sizeBytes: slot.size,
    blobPath: slot.blob
  };
}

function preprocessFromApi(
  role: "protocol" | "acrf",
  status: Step1UploadStatusResponse,
  previous: PreprocessStatus
): PreprocessStatus {
  if (previous === "running") {
    return "running";
  }
  if (role === "protocol" && status.protocolPreprocessed) {
    return "done";
  }
  if (role === "acrf" && status.acrfPreprocessed) {
    return "done";
  }
  const uploaded = role === "protocol" ? status.protocol.uploaded : status.acrf.uploaded;
  return uploaded ? previous : "idle";
}

function readSession(studyId: string): Partial<StudyPipelineState> | null {
  try {
    const raw = sessionStorage.getItem(`${SESSION_PREFIX}${studyId}`);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as Partial<StudyPipelineState>;
  } catch {
    return null;
  }
}

function writeSession(studyId: string, state: StudyPipelineState): void {
  try {
    sessionStorage.setItem(`${SESSION_PREFIX}${studyId}`, JSON.stringify(state));
  } catch {
    // ignore quota errors
  }
}

export interface UseStudyPipelineStateResult {
  pipeline: StudyPipelineState;
  setPipeline: Dispatch<SetStateAction<StudyPipelineState>>;
  isLoadingUploadStatus: boolean;
  uploadStatusError: string;
  refreshUploadStatus: (overrideStudyId?: string) => Promise<Step1UploadStatusResponse | null>;
  refreshRunState: (overrideStudyId?: string) => Promise<void>;
  applyUploadStatus: (status: Step1UploadStatusResponse) => void;
  setUploadSlot: (slot: "protocol" | "acrf" | "pdSpec", patch: Partial<DocumentUploadState>) => void;
  setPreprocess: (slot: "protocol" | "acrf", status: PreprocessStatus) => void;
  setExtraction: (patch: Partial<ExtractionRunState>) => void;
  resetForStudy: () => void;
}

export function useStudyPipelineState(
  studyId: string,
  onStatusesChange?: (statuses: Record<string, StepStatus>) => void
): UseStudyPipelineStateResult {
  const [pipeline, setPipeline] = useState<StudyPipelineState>(defaultPipelineState);
  const [isLoadingUploadStatus, setIsLoadingUploadStatus] = useState(false);
  const [uploadStatusError, setUploadStatusError] = useState("");
  const studyRef = useRef("");

  const applyUploadStatus = useCallback(
    (status: Step1UploadStatusResponse) => {
      setPipeline((previous) => ({
        ...previous,
        bothUploaded: status.bothUploaded,
        allThreeUploaded: status.allThreeUploaded ?? (status.bothUploaded && status.pdSpec.uploaded),
        uploads: {
          protocol: uploadStateFromApi(status.protocol),
          acrf: uploadStateFromApi(status.acrf),
          pdSpec: uploadStateFromApi(status.pdSpec)
        },
        preprocess: {
          protocol: preprocessFromApi("protocol", status, previous.preprocess.protocol),
          acrf: preprocessFromApi("acrf", status, previous.preprocess.acrf)
        }
      }));
      onStatusesChange?.(status.stepStatuses);
    },
    [onStatusesChange]
  );

  const refreshUploadStatus = useCallback(
    async (overrideStudyId?: string): Promise<Step1UploadStatusResponse | null> => {
      const trimmed = (overrideStudyId ?? studyId).trim();
      if (!trimmed) {
        return null;
      }
      setIsLoadingUploadStatus(true);
      setUploadStatusError("");
      try {
        const status = await fetchStep1UploadStatus(trimmed);
        applyUploadStatus(status);
        return status;
      } catch (loadError) {
        const message = loadError instanceof Error ? loadError.message : "Unable to load upload status.";
        setUploadStatusError(message);
        return null;
      } finally {
        setIsLoadingUploadStatus(false);
      }
    },
    [applyUploadStatus, studyId]
  );

  const refreshRunState = useCallback(async (overrideStudyId?: string): Promise<void> => {
    const trimmed = (overrideStudyId ?? studyId).trim();
    if (!trimmed) {
      return;
    }
    try {
      const runState = await fetchStep1RunState(trimmed);
      const sub = runState.currentSubStepId;
      setPipeline((previous) => {
        const next = {
          ...previous,
          extraction: {
            status: runState.status,
            currentStage: runState.currentStage,
            currentSubStepId: runState.currentSubStepId,
            message: runState.message,
            error: runState.error,
            logs: runState.logs
          }
        };
        if (sub === "preprocess-protocol" && runState.status === "running") {
          next.preprocess = { ...next.preprocess, protocol: "running" };
        } else if (sub === "preprocess-protocol" && runState.status === "done") {
          next.preprocess = { ...next.preprocess, protocol: "done" };
        } else if (sub === "preprocess-protocol" && runState.status === "failed") {
          next.preprocess = { ...next.preprocess, protocol: "failed" };
        } else if (sub === "preprocess-acrf" && runState.status === "running") {
          next.preprocess = { ...next.preprocess, acrf: "running" };
        } else if (sub === "preprocess-acrf" && runState.status === "done") {
          next.preprocess = { ...next.preprocess, acrf: "done" };
        } else if (sub === "preprocess-acrf" && runState.status === "failed") {
          next.preprocess = { ...next.preprocess, acrf: "failed" };
        }
        return next;
      });
    } catch {
      // keep local state
    }
  }, [studyId]);

  const resetForStudy = useCallback(() => {
    setPipeline(defaultPipelineState());
  }, []);

  const setUploadSlot = useCallback(
    (slot: "protocol" | "acrf" | "pdSpec", patch: Partial<DocumentUploadState>) => {
      setPipeline((previous) => ({
        ...previous,
        uploads: {
          ...previous.uploads,
          [slot]: { ...previous.uploads[slot], ...patch }
        }
      }));
    },
    []
  );

  const setPreprocess = useCallback((slot: "protocol" | "acrf", status: PreprocessStatus) => {
    setPipeline((previous) => ({
      ...previous,
      preprocess: { ...previous.preprocess, [slot]: status }
    }));
  }, []);

  const setExtraction = useCallback((patch: Partial<ExtractionRunState>) => {
    setPipeline((previous) => ({
      ...previous,
      extraction: { ...previous.extraction, ...patch }
    }));
  }, []);

  useEffect(() => {
    if (studyRef.current === studyId) {
      return;
    }
    studyRef.current = studyId;
    const session = readSession(studyId);
    if (session) {
      setPipeline({
        uploads: {
          protocol: { ...defaultUploadState(), ...session.uploads?.protocol },
          acrf: { ...defaultUploadState(), ...session.uploads?.acrf },
          pdSpec: { ...defaultUploadState(), ...session.uploads?.pdSpec }
        },
        bothUploaded: session.bothUploaded ?? false,
        allThreeUploaded: session.allThreeUploaded ?? false,
        preprocess: {
          protocol: session.preprocess?.protocol ?? "idle",
          acrf: session.preprocess?.acrf ?? "idle"
        },
        extraction: { ...defaultExtractionState(), ...session.extraction }
      });
    } else {
      setPipeline(defaultPipelineState());
    }
    void refreshUploadStatus(studyId);
    void refreshRunState(studyId);
  }, [studyId, refreshUploadStatus, refreshRunState]);

  useEffect(() => {
    const trimmed = studyId.trim();
    if (!trimmed) {
      return;
    }
    writeSession(trimmed, pipeline);
  }, [studyId, pipeline]);

  return {
    pipeline,
    setPipeline,
    isLoadingUploadStatus,
    uploadStatusError,
    refreshUploadStatus,
    refreshRunState,
    applyUploadStatus,
    setUploadSlot,
    setPreprocess,
    setExtraction,
    resetForStudy
  };
}

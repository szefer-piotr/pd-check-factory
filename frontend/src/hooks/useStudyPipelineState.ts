import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  fetchStep1RunState,
  fetchStep1UploadStatus,
  type PipelineLogLine,
  type Step1UploadStatusResponse,
  type StepStatus
} from "../services/stepApi";

export type UploadSlotStatus = "missing" | "selected" | "uploading" | "uploaded" | "error";

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
  uploads: { protocol: DocumentUploadState; acrf: DocumentUploadState };
  bothUploaded: boolean;
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
    uploads: { protocol: defaultUploadState(), acrf: defaultUploadState() },
    bothUploaded: false,
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
  setUploadSlot: (slot: "protocol" | "acrf", patch: Partial<DocumentUploadState>) => void;
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
        uploads: {
          protocol: uploadStateFromApi(status.protocol),
          acrf: uploadStateFromApi(status.acrf)
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
      setPipeline((previous) => ({
        ...previous,
        extraction: {
          status: runState.status,
          currentStage: runState.currentStage,
          currentSubStepId: runState.currentSubStepId,
          message: runState.message,
          error: runState.error,
          logs: runState.logs
        }
      }));
    } catch {
      // keep local state
    }
  }, [studyId]);

  const resetForStudy = useCallback(() => {
    setPipeline(defaultPipelineState());
  }, []);

  const setUploadSlot = useCallback((slot: "protocol" | "acrf", patch: Partial<DocumentUploadState>) => {
    setPipeline((previous) => ({
      ...previous,
      uploads: {
        ...previous.uploads,
        [slot]: { ...previous.uploads[slot], ...patch }
      }
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
          acrf: { ...defaultUploadState(), ...session.uploads?.acrf }
        },
        bothUploaded: session.bothUploaded ?? false,
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
    setExtraction,
    resetForStudy
  };
}

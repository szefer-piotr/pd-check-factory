export type StepStatus = "pending" | "done";

export interface ApiErrorPayload {
  code: string;
  message: string;
}

export interface ApiEnvelope<T> {
  ok: boolean;
  requestId: string;
  data: T | null;
  error: ApiErrorPayload | null;
}

export interface StepItemStatus {
  stepId: string;
  status: StepStatus;
}

export interface StepStatusesResponse {
  studyId: string;
  steps: StepItemStatus[];
  nextStepId: string | null;
}

export interface StepPreviewItem {
  title: string;
  body: string;
  highlight?: boolean;
}

export interface StepPreviewResponse {
  studyId: string;
  stepId: string;
  previews: StepPreviewItem[];
  stepStatuses: Record<string, StepStatus>;
}

export interface Step1UploadResponse {
  studyId: string;
  protocolBlob: string;
  acrfBlob: string;
  protocolSize: number;
  acrfSize: number;
  stepStatuses: Record<string, StepStatus>;
}

export interface Step1ExtractResponse {
  studyId: string;
  message: string;
  stepStatuses: Record<string, StepStatus>;
}

export interface Step1PreviewResponse {
  studyId: string;
  protocolPreview: string;
  acrfPreview: string;
  protocolPreviewPath: string;
  acrfPreviewPath: string;
  protocolExists: boolean;
  acrfExists: boolean;
  stepStatuses: Record<string, StepStatus>;
}

export interface StepRunResponse {
  studyId: string;
  stepId: string;
  summary: string;
  stepStatuses: Record<string, StepStatus>;
}

const API_BASE = (import.meta.env.VITE_PD_API_BASE as string | undefined) ?? "http://127.0.0.1:8787";

async function parseApiResponse<T>(response: Response): Promise<T> {
  let parsed: ApiEnvelope<T> | null = null;
  try {
    parsed = (await response.json()) as ApiEnvelope<T>;
  } catch {
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    throw new Error("Invalid API response.");
  }

  if (!response.ok || !parsed.ok || !parsed.data) {
    const msg = parsed.error?.message ?? `HTTP ${response.status}`;
    throw new Error(msg);
  }
  return parsed.data;
}

export async function fetchStepStatuses(studyId: string): Promise<StepStatusesResponse> {
  const response = await fetch(`${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/steps/status`);
  return parseApiResponse<StepStatusesResponse>(response);
}

export async function uploadStep1Files(studyId: string, protocolFile: File, acrfFile: File): Promise<Step1UploadResponse> {
  const formData = new FormData();
  formData.append("protocolFile", protocolFile);
  formData.append("acrfFile", acrfFile);

  const response = await fetch(`${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/step1/upload`, {
    method: "POST",
    body: formData
  });
  return parseApiResponse<Step1UploadResponse>(response);
}

export async function runStep1Extraction(studyId: string): Promise<Step1ExtractResponse> {
  const response = await fetch(`${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/step1/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
  return parseApiResponse<Step1ExtractResponse>(response);
}

export async function fetchStep1Preview(studyId: string): Promise<Step1PreviewResponse> {
  const response = await fetch(`${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/step1/preview`);
  return parseApiResponse<Step1PreviewResponse>(response);
}

export async function runStep(studyId: string, stepId: string): Promise<StepRunResponse> {
  const response = await fetch(`${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/steps/${encodeURIComponent(stepId)}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
  return parseApiResponse<StepRunResponse>(response);
}

export async function fetchStepPreview(studyId: string, stepId: string): Promise<StepPreviewResponse> {
  const response = await fetch(
    `${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/steps/${encodeURIComponent(stepId)}/preview`
  );
  return parseApiResponse<StepPreviewResponse>(response);
}

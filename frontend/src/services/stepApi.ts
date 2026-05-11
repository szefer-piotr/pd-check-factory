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

export type Step1PdfExtractor = "opendataloader" | "document_intelligence" | "both";

export interface Step1ExtractResponse {
  studyId: string;
  message: string;
  extractor?: string;
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
  extractor?: string | null;
  stepStatuses: Record<string, StepStatus>;
}

export interface StepRunResponse {
  studyId: string;
  stepId: string;
  summary: string;
  stepStatuses: Record<string, StepStatus>;
}

export interface Step7DeviationRow {
  rule_id: string;
  deviation_id: string;
  rule_title: string;
  deviation_text: string;
  paragraph_refs: string[];
  paragraph_refs_text: string;
  pseudo_logic: string;
  status: "pending" | "to_review" | "accepted" | "rejected";
  dm_comment: string;
  programmable: boolean | null;
  programmability_note: string;
}

export interface Step7DeviationsResponse {
  studyId: string;
  columns: string[];
  rows: Step7DeviationRow[];
  stepStatuses: Record<string, StepStatus>;
}

export interface Step7ChatMessage {
  role: string;
  text: string;
  ts: string;
}

export interface Step7DeviationChatResponse {
  studyId: string;
  deviationId: string;
  messages: Step7ChatMessage[];
}

export interface Step7RefineResponse {
  studyId: string;
  deviationId: string;
  row: Step7DeviationRow;
  messages: Step7ChatMessage[];
  audit: Record<string, unknown>;
  stepStatuses: Record<string, StepStatus>;
}

export interface Step7UpdateResponse {
  studyId: string;
  deviationId: string;
  row: Step7DeviationRow;
  stepStatuses: Record<string, StepStatus>;
}

export interface Step7PseudoLogicSingleResponse {
  studyId: string;
  deviationId: string;
  row: Step7DeviationRow;
  stepStatuses: Record<string, StepStatus>;
}

export interface Step7PseudoLogicBulkResponse {
  studyId: string;
  generated: number;
  rows: Step7DeviationRow[];
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

export async function runStep1Extraction(studyId: string, extractor: Step1PdfExtractor): Promise<Step1ExtractResponse> {
  const response = await fetch(`${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/step1/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ extractor })
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

export async function fetchStep7Deviations(studyId: string): Promise<Step7DeviationsResponse> {
  const response = await fetch(`${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/step7/deviations`);
  return parseApiResponse<Step7DeviationsResponse>(response);
}

export async function fetchStep7DeviationChat(studyId: string, deviationId: string): Promise<Step7DeviationChatResponse> {
  const response = await fetch(
    `${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/step7/deviations/${encodeURIComponent(deviationId)}/chat`
  );
  return parseApiResponse<Step7DeviationChatResponse>(response);
}

export async function refineStep7Deviation(
  studyId: string,
  deviationId: string,
  message: string,
  runRevisionCycle = true
): Promise<Step7RefineResponse> {
  const response = await fetch(
    `${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/step7/deviations/${encodeURIComponent(deviationId)}/refine`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, runRevisionCycle })
    }
  );
  return parseApiResponse<Step7RefineResponse>(response);
}

export async function updateStep7DeviationStatus(
  studyId: string,
  deviationId: string,
  status: Step7DeviationRow["status"],
  dmComment?: string
): Promise<Step7UpdateResponse> {
  const response = await fetch(
    `${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/step7/deviations/${encodeURIComponent(deviationId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, dmComment })
    }
  );
  return parseApiResponse<Step7UpdateResponse>(response);
}

export async function generateStep7PseudoLogic(
  studyId: string,
  deviationId: string
): Promise<Step7PseudoLogicSingleResponse> {
  const response = await fetch(
    `${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/step7/deviations/${encodeURIComponent(deviationId)}/pseudo-logic`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    }
  );
  return parseApiResponse<Step7PseudoLogicSingleResponse>(response);
}

export async function generateStep7PseudoLogicAll(studyId: string): Promise<Step7PseudoLogicBulkResponse> {
  const response = await fetch(
    `${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/step7/pseudo-logic/generate-all`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    }
  );
  return parseApiResponse<Step7PseudoLogicBulkResponse>(response);
}

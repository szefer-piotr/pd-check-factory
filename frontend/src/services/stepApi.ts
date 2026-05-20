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

export interface StudyOption {
  studyId: string;
  protocolBlob: string;
  acrfBlob: string;
  protocolFileName?: string;
  acrfFileName?: string;
  bothUploaded?: boolean;
  stepStatuses: Record<string, StepStatus>;
  nextStepId: string | null;
}

export interface StudiesResponse {
  studies: StudyOption[];
}

export interface DeleteStudyResponse {
  studyId: string;
  deletedBlobCount: number;
  totalBlobCount: number;
  blobPrefixes: string[];
  localOutputRemoved: boolean;
  message: string;
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
  protocolFileName?: string;
  acrfFileName?: string;
  protocolSize: number;
  acrfSize: number;
  bothUploaded?: boolean;
  stepStatuses: Record<string, StepStatus>;
}

export interface Step1UploadSlotStatus {
  uploaded: boolean;
  fileName: string;
  size: number;
  blob: string;
}

export interface Step1UploadStatusResponse {
  studyId: string;
  protocol: Step1UploadSlotStatus;
  acrf: Step1UploadSlotStatus;
  bothUploaded: boolean;
  stepStatuses: Record<string, StepStatus>;
}

export interface PipelineLogLine {
  ts: string;
  level: "info" | "warn" | "error";
  text: string;
}

export interface Step1RunStateResponse {
  studyId: string;
  status: "idle" | "running" | "done" | "failed";
  currentStage: string;
  currentSubStepId: string;
  message: string;
  error: string;
  startedAt: string;
  finishedAt: string;
  logs: PipelineLogLine[];
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
  protocolFileName?: string;
  acrfFileName?: string;
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
  rule_text: string;
  deviation_text: string;
  paragraph_refs: string[];
  paragraph_refs_text: string;
  supporting_sentences: Array<{ ref: string; text: string }>;
  data_support_note: string;
  pseudo_logic: string;
  status: "pending" | "to_review" | "accepted" | "rejected";
  dm_comment: string;
  entry_source: string;
  programmable: boolean | null;
  programmability_note: string;
}

export interface Step7DeviationPayload {
  deviation_id: string;
  rule_id: string;
  text: string;
  paragraph_refs: string[];
  data_support_note?: string;
  dm_comment?: string;
  status?: Step7DeviationRow["status"];
}

export interface Step7RulePayload {
  rule_id: string;
  title?: string;
  text?: string;
  paragraph_refs?: string[];
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
  responseType?: string;
  agentReason?: string;
  missingCaveats?: string[];
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

export interface Step7AcceptAllResponse {
  studyId: string;
  accepted: number;
  rows: Step7DeviationRow[];
  stepStatuses: Record<string, StepStatus>;
}

export interface Step7DeviationListMutationResponse extends Step7DeviationsResponse {
  imported?: number;
}

export interface Step7RuleMutationResponse {
  studyId: string;
  rule?: Step7RulePayload;
  deletedRuleId?: string;
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

export interface SyncStudyResponse {
  studyId: string;
  sync: {
    uploaded: number;
    downloaded: number;
    skipped: number;
    errors: number;
    errorMessages: string[];
  };
  stepStatuses: Record<string, StepStatus>;
}

export async function syncStudy(studyId: string): Promise<SyncStudyResponse> {
  const response = await fetch(`${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}"
  });
  return parseApiResponse<SyncStudyResponse>(response);
}

export async function fetchStudies(): Promise<StudiesResponse> {
  const response = await fetch(`${API_BASE}/api/v1/studies`);
  return parseApiResponse<StudiesResponse>(response);
}

export async function deleteStudy(studyId: string): Promise<DeleteStudyResponse> {
  const response = await fetch(`${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}`, {
    method: "DELETE"
  });
  return parseApiResponse<DeleteStudyResponse>(response);
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

export async function uploadStep1File(
  studyId: string,
  slot: "protocol" | "acrf",
  file: File
): Promise<Step1UploadResponse> {
  const formData = new FormData();
  formData.append(slot === "protocol" ? "protocolFile" : "acrfFile", file);

  const response = await fetch(`${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/step1/upload`, {
    method: "POST",
    body: formData
  });
  return parseApiResponse<Step1UploadResponse>(response);
}

export async function fetchStep1UploadStatus(studyId: string): Promise<Step1UploadStatusResponse> {
  const response = await fetch(`${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/step1/upload-status`);
  return parseApiResponse<Step1UploadStatusResponse>(response);
}

export async function fetchStep1RunState(studyId: string): Promise<Step1RunStateResponse> {
  const response = await fetch(`${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/step1/run-state`);
  return parseApiResponse<Step1RunStateResponse>(response);
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

export async function runStep(
  studyId: string,
  stepId: string,
  options?: { llmInstructions?: string }
): Promise<StepRunResponse> {
  const body: Record<string, string> = {};
  const note = options?.llmInstructions?.trim();
  if (note) {
    body.llmInstructions = note;
  }
  const response = await fetch(`${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/steps/${encodeURIComponent(stepId)}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
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
  runRevisionCycle = true,
  alsoPseudo = false
): Promise<Step7RefineResponse> {
  const response = await fetch(
    `${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/step7/deviations/${encodeURIComponent(deviationId)}/refine`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, runRevisionCycle, alsoPseudo })
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

export async function createStep7Deviation(
  studyId: string,
  payload: Step7DeviationPayload
): Promise<Step7DeviationListMutationResponse> {
  const response = await fetch(`${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/step7/deviations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return parseApiResponse<Step7DeviationListMutationResponse>(response);
}

export async function updateStep7Deviation(
  studyId: string,
  deviationId: string,
  payload: Partial<Step7DeviationPayload>
): Promise<Step7UpdateResponse> {
  const response = await fetch(
    `${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/step7/deviations/${encodeURIComponent(deviationId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }
  );
  return parseApiResponse<Step7UpdateResponse>(response);
}

export async function deleteStep7Deviation(
  studyId: string,
  deviationId: string
): Promise<Step7DeviationListMutationResponse> {
  const response = await fetch(
    `${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/step7/deviations/${encodeURIComponent(deviationId)}`,
    { method: "DELETE" }
  );
  return parseApiResponse<Step7DeviationListMutationResponse>(response);
}

export interface Step7ExportWorkbookResult {
  blob: Blob;
  fileName: string;
  rowCount?: number;
}

function parseContentDispositionFileName(header: string | null, fallback: string): string {
  if (!header) {
    return fallback;
  }
  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }
  const plainMatch = /filename="?([^";]+)"?/i.exec(header);
  return plainMatch?.[1]?.trim() || fallback;
}

export async function exportStep7DeviationsWorkbook(studyId: string): Promise<Step7ExportWorkbookResult> {
  const response = await fetch(
    `${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/step7/deviations/export`
  );
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const parsed = (await response.json()) as ApiEnvelope<unknown>;
      message = parsed.error?.message ?? message;
    } catch {
      // ignore non-JSON error bodies
    }
    throw new Error(message);
  }
  const blob = await response.blob();
  const fileName = parseContentDispositionFileName(
    response.headers.get("Content-Disposition"),
    `${studyId}_deviations_review.xlsx`
  );
  return { blob, fileName };
}

export async function importStep7DeviationsWorkbook(
  studyId: string,
  workbook: File
): Promise<Step7DeviationListMutationResponse> {
  const formData = new FormData();
  formData.append("workbook", workbook);
  const response = await fetch(`${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/step7/deviations/import`, {
    method: "POST",
    body: formData
  });
  return parseApiResponse<Step7DeviationListMutationResponse>(response);
}

export async function createStep7Rule(studyId: string, payload: Step7RulePayload): Promise<Step7RuleMutationResponse> {
  const response = await fetch(`${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/step7/rules`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return parseApiResponse<Step7RuleMutationResponse>(response);
}

export async function updateStep7Rule(
  studyId: string,
  ruleId: string,
  payload: Partial<Step7RulePayload>
): Promise<Step7RuleMutationResponse> {
  const response = await fetch(`${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/step7/rules/${encodeURIComponent(ruleId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return parseApiResponse<Step7RuleMutationResponse>(response);
}

export async function deleteStep7Rule(studyId: string, ruleId: string): Promise<Step7RuleMutationResponse> {
  const response = await fetch(`${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/step7/rules/${encodeURIComponent(ruleId)}`, {
    method: "DELETE"
  });
  return parseApiResponse<Step7RuleMutationResponse>(response);
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

export async function acceptStep7DeviationsAll(studyId: string): Promise<Step7AcceptAllResponse> {
  const response = await fetch(
    `${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/step7/deviations/accept-all`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    }
  );
  return parseApiResponse<Step7AcceptAllResponse>(response);
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

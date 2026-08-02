export type StepStatus = "pending" | "done" | "skipped";

export type EntryMode = "extracted" | "imported_pd_spec";

export type Step7ReviewSource = "generated" | "imported_pd_spec" | "enriched_pd_spec";

export interface Step7ReviewSourceOption {
  key: Step7ReviewSource;
  label: string;
  available: boolean;
  rowCount: number;
}

export interface Step7ReviewSourcesResponse {
  studyId: string;
  sources: Step7ReviewSourceOption[];
  selectedSource: Step7ReviewSource;
  stepStatuses: Record<string, StepStatus>;
}

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
  /** Backend step ids this step depends on (from STEP_DEPENDENCIES). */
  dependencies?: string[];
  /** Primary output count for done steps (e.g. 42 rules). */
  count?: number;
  unit?: string;
}

export interface StepStatusesResponse {
  studyId: string;
  entryMode?: EntryMode;
  activeDeviationsSource?: string | null;
  codingPhaseAccepted?: boolean;
  codingPhaseAcceptedAt?: string | null;
  importVersions?: ImportVersionsInfo;
  activeStepArtifacts?: Record<string, string>;
  stepArtifactVersions?: StepArtifactVersionsMap;
  steps: StepItemStatus[];
  nextStepId: string | null;
}

export interface AcceptCodingPhaseResponse {
  studyId: string;
  codingPhaseAccepted: boolean;
  codingPhaseAcceptedAt?: string | null;
  stepStatuses: Record<string, StepStatus>;
}

export interface ImportVersionsInfo {
  imports: string[];
  merged: string[];
}

export interface ImportSourceOption {
  key: string;
  label: string;
  type: "import" | "merged";
}

export type WorkflowChoice = "extract" | "map" | "enrich";

export type WizardStage = "project" | "setup" | "summary" | "processing" | "review";

export type Step1PdfExtractor = "opendataloader" | "document_intelligence" | "both";

export interface StudyRunUploads {
  protocolFileName: string;
  acrfFileName: string;
  pdSpecFileName: string | null;
}

export interface StudyRunSettings {
  extractorChoice: Step1PdfExtractor;
  extractionDeployment: string;
  acrfSummaryDeployment: string;
  extractionLlmInstructions: string;
}

export interface StudyRunEntry {
  runId: string;
  fingerprint: string;
  createdAt: string;
  updatedAt: string;
  workflow: WorkflowChoice;
  uploads: StudyRunUploads;
  settings: StudyRunSettings;
  lastRunAt: string | null;
  stepStatusesSnapshot: Record<string, StepStatus>;
}

export interface StudyRunsResponse {
  studyId: string;
  activeRunId: string;
  runs: StudyRunEntry[];
}

export interface ApplyStudyRunResponse {
  studyId: string;
  runId: string;
  fingerprint: string;
  created: boolean;
  settings: StudyRunSettings;
  activeRunId: string;
  runs: StudyRunEntry[];
}

export interface ActivateStudyRunResponse {
  studyId: string;
  activeRunId: string;
  settings: StudyRunSettings;
  run: StudyRunEntry;
}

export interface StudyListItem {
  studyId: string;
  workflow: WorkflowChoice | null;
  workflowLabel: string;
  stage: WizardStage;
  lastModified?: string | null;
}

export interface StudyUploadSlot {
  uploaded: boolean;
  fileName: string;
  size: number;
  blob: string;
}

export interface DeviationSummary {
  total: number;
  accepted: number;
  toReview: number;
  rejected: number;
}

export interface StudySummary {
  studyId: string;
  workflow: WorkflowChoice | null;
  inferredWorkflow?: WorkflowChoice | null;
  workflowLabel: string;
  stage: WizardStage;
  entryMode: EntryMode;
  workflowChoice?: WorkflowChoice | null;
  pdSpecImportMode?: string | null;
  lastModified?: string | null;
  uiStage?: string | null;
  uploads: {
    protocol: StudyUploadSlot;
    acrf: StudyUploadSlot;
    pdSpec: StudyUploadSlot;
  };
  bothUploaded: boolean;
  allThreeUploaded: boolean;
  preprocess: {
    protocol: boolean;
    acrf: boolean;
  };
  processingComplete: boolean;
  runState: Step1RunStateResponse;
  steps: StepItemStatus[];
  stepStatuses: Record<string, StepStatus>;
  nextStepId: string | null;
  importVersions?: ImportVersionsInfo;
  activeStepArtifacts?: Record<string, string>;
  stepArtifactVersions?: StepArtifactVersionsMap;
  codingPhaseAccepted?: boolean;
  deviationSummary?: DeviationSummary | null;
}

/** @deprecated Use StudyListItem for library list. */
export type StudyOption = StudyListItem;

export interface StudiesResponse {
  studies: StudyListItem[];
}

export interface CreateStudyResponse {
  studyId: string;
  manifestBlobPath: string;
  overwritten?: boolean;
  deletedBlobCount?: number;
  totalBlobCount?: number;
  localOutputRemoved?: boolean;
}

export interface PatchStudyManifestResponse {
  studyId: string;
  stage: WizardStage;
  workflow: WorkflowChoice | null;
}

export interface OpenAiDeploymentOption {
  id: string;
  modelName: string;
  version: string;
  supportsTemperature?: boolean;
}

export interface OpenAiDeploymentsResponse {
  deployments: OpenAiDeploymentOption[];
  defaultDeployment: string;
  source?: string;
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
  partial?: boolean;
  itemCount?: number;
  generatedAt?: string;
  version?: string | null;
  versionCreatedAt?: string;
}

export interface StepArtifactVersionEntry {
  version: string;
  created_at: string;
  generated_at: string;
  itemCount: number;
  active?: boolean;
  sourceVersions?: Record<string, unknown>;
  sourceSummary?: string;
  derivedFrom?: { version?: string; operation?: string };
}

export interface StepArtifactVersionsInfo {
  stepId: string;
  activeVersion?: string | null;
  versions: StepArtifactVersionEntry[];
}

export type StepArtifactVersionsMap = Record<string, StepArtifactVersionsInfo>;

export interface StepArtifactVersionsResponse {
  studyId: string;
  stepId: string;
  activeVersion?: string | null;
  versions: StepArtifactVersionEntry[];
  activeStepArtifacts: Record<string, string>;
  stepStatuses: Record<string, StepStatus>;
}

export interface SetActiveStepArtifactResponse {
  studyId: string;
  stepId: string;
  version: string;
  itemCount: number;
  activeStepArtifacts: Record<string, string>;
  stepStatuses: Record<string, StepStatus>;
}

export const VERSIONED_BACKEND_STEP_IDS = [
  "acrf-summary-text",
  "extract-rules",
  "extract-deviations"
] as const;

export type VersionedBackendStepId = (typeof VERSIONED_BACKEND_STEP_IDS)[number];

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
  pdSpec: Step1UploadSlotStatus;
  bothUploaded: boolean;
  allThreeUploaded?: boolean;
  protocolPreprocessed?: boolean;
  acrfPreprocessed?: boolean;
  processingCoreComplete?: boolean;
  processingComplete?: boolean;
  stepStatuses: Record<string, StepStatus>;
}

export interface PreprocessResponse {
  studyId: string;
  role: "protocol" | "acrf";
  message: string;
  protocolPreprocessed?: boolean;
  acrfPreprocessed?: boolean;
  stepStatuses: Record<string, StepStatus>;
}

export interface PipelineLogLine {
  ts: string;
  level: "info" | "warn" | "error";
  text: string;
}

export interface LlmProgress {
  phase: string;
  current: number;
  total: number;
  unit: string;
  label?: string;
}

export interface RunStateProgress {
  done: number;
  total: number;
  currentItem: string;
}

export interface ExtractionLiveRule {
  rule_id: string;
  title: string;
  text: string;
  paragraph_refs: string[];
}

export interface ExtractionLiveDeviation {
  deviation_id: string;
  rule_id: string;
  text: string;
  paragraph_refs: string[];
  data_support_note: string;
  status: string;
}

export interface ExtractionLiveResponse {
  studyId: string;
  rules: ExtractionLiveRule[];
  deviations: ExtractionLiveDeviation[];
  ruleCount: number;
  deviationCount: number;
  partial: boolean;
  completedRuleIds: string[];
  llmProgress: LlmProgress | null;
  runStatus: "idle" | "running" | "done" | "failed";
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
  /** Structured per-item progress for long loops (sections / rules). */
  progress?: RunStateProgress | null;
  logs: PipelineLogLine[];
  llmProgress?: LlmProgress | null;
}

export interface Step1ExtractResponse {
  studyId: string;
  message: string;
  extractor?: string;
  skipped?: boolean;
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

export interface SpecificationPreviewDeviationRow {
  deviation_id: string;
  rule_id: string;
  rule_title: string;
  deviation_text: string;
  text: string;
  entry_source: string;
  status: string;
}

export type SpecificationPreviewRow = SpecificationPreviewDeviationRow | Record<string, string>;

export interface SpecificationPreviewSource {
  key: string;
  label: string;
  /** When set, rows are spreadsheet cells keyed by these column headers (workbook import). */
  columns?: string[];
  rows: SpecificationPreviewRow[];
}

export interface SpecificationsPreviewResponse {
  studyId: string;
  sources: SpecificationPreviewSource[];
  stepStatuses: Record<string, StepStatus>;
}

export interface StepRunResponse {
  studyId: string;
  stepId: string;
  summary: string;
  skipped?: boolean;
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
  manual_or_programmable?: "Programmable" | "Partially programmable" | "Manual" | "";
  programmability_note: string;
  protocol_deviation_category?: string;
  protocol_deviation_sub_category?: string;
  original_deviation_text?: string;
  suggested_deviation_text?: string;
  enrichment_status?: string;
  enrichment_summary?: string;
  assumptions?: string[];
  caveats?: string[];
  data_gaps?: string[];
  weak_spots?: string[];
  suggested_changes?: string[];
  protocol_conflicts?: string[];
  programmability_risk?: string;
  required_datasets?: string[];
  required_fields?: string[];
  enrichment_errors?: Record<string, string>;
  improved_pseudo_logic_plain_english?: string;
}

export interface Step7DeviationPayload {
  deviation_id: string;
  rule_id: string;
  text: string;
  paragraph_refs: string[];
  data_support_note?: string;
  dm_comment?: string;
  status?: Step7DeviationRow["status"];
  protocol_deviation_category?: string;
  protocol_deviation_sub_category?: string;
}

export interface PdTaxonomyResponse {
  categories: Record<string, string[]>;
  categoryOptions: string[];
  subCategoryOptions: string[];
}

export interface Step7RulePayload {
  rule_id: string;
  title?: string;
  text?: string;
  paragraph_refs?: string[];
}

export interface Step7DeviationsResponse {
  studyId: string;
  reviewSource?: Step7ReviewSource;
  columns: string[];
  rows: Step7DeviationRow[];
  stepStatuses: Record<string, StepStatus>;
}

function step7ReviewQuery(reviewSource?: Step7ReviewSource): string {
  if (!reviewSource) {
    return "";
  }
  return `?reviewSource=${encodeURIComponent(reviewSource)}`;
}

function step7ReviewJsonBody(payload: object, reviewSource?: Step7ReviewSource): string {
  const body = reviewSource ? { ...payload, reviewSource } : payload;
  return JSON.stringify(body);
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

export async function acceptCodingPhase(studyId: string): Promise<AcceptCodingPhaseResponse> {
  const response = await fetch(`${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/coding/accept`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}"
  });
  return parseApiResponse<AcceptCodingPhaseResponse>(response);
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

export interface LoadStudyResponse {
  studyId: string;
  sync: SyncStudyResponse["sync"];
  summary: StudySummary;
  stepStatuses: Record<string, StepStatus>;
}

export interface DeleteAllStudiesResponse {
  deletedStudyCount: number;
  deletedBlobCount: number;
  totalBlobCount: number;
  studies: Array<{
    studyId: string;
    deletedBlobCount: number;
    totalBlobCount: number;
    localOutputRemoved: boolean;
  }>;
  message: string;
}

export async function syncStudy(
  studyId: string,
  options?: { timeoutMs?: number; signal?: AbortSignal }
): Promise<SyncStudyResponse> {
  const controller = new AbortController();
  const timeoutMs = options?.timeoutMs ?? 120_000;
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  if (options?.signal) {
    if (options.signal.aborted) {
      controller.abort();
    } else {
      options.signal.addEventListener("abort", () => controller.abort(), { once: true });
    }
  }
  try {
    const response = await fetch(`${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: controller.signal
    });
    return parseApiResponse<SyncStudyResponse>(response);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Study sync timed out. The UI will keep using local files; retry sync when ready.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function loadStudy(
  studyId: string,
  options?: { timeoutMs?: number; signal?: AbortSignal }
): Promise<LoadStudyResponse> {
  const controller = new AbortController();
  const timeoutMs = options?.timeoutMs ?? 300_000;
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  if (options?.signal) {
    if (options.signal.aborted) {
      controller.abort();
    } else {
      options.signal.addEventListener("abort", () => controller.abort(), { once: true });
    }
  }
  try {
    const response = await fetch(`${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/load`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: controller.signal
    });
    return parseApiResponse<LoadStudyResponse>(response);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Study load timed out. Retry when the connection is stable.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function fetchStudies(): Promise<StudiesResponse> {
  const response = await fetch(`${API_BASE}/api/v1/studies`);
  return parseApiResponse<StudiesResponse>(response);
}

export async function createStudy(
  studyId: string,
  options?: { overwrite?: boolean }
): Promise<CreateStudyResponse> {
  const response = await fetch(`${API_BASE}/api/v1/studies`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ studyId, overwrite: options?.overwrite === true })
  });
  return parseApiResponse<CreateStudyResponse>(response);
}

export async function fetchStudySummary(studyId: string): Promise<StudySummary> {
  const response = await fetch(`${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/summary`);
  return parseApiResponse<StudySummary>(response);
}

export interface CostLlmTotals {
  calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: number | null;
}

export interface CostDiTotals {
  calls: number;
  pages: number;
  cost_usd: number | null;
}

export interface CostStepBucket {
  llm: CostLlmTotals;
  document_intelligence: CostDiTotals;
  cost_usd: number | null;
}

export interface CostUsageResponse {
  studyId: string;
  available: boolean;
  artifactPath: string;
  schemaVersion?: string;
  updatedAt?: string;
  pricingSource?: string;
  totals: {
    llm: CostLlmTotals;
    document_intelligence: CostDiTotals;
    cost_usd: number | null;
  };
  byStep: Record<string, CostStepBucket>;
  eventCount: number;
}

export async function fetchCostUsage(studyId: string): Promise<CostUsageResponse> {
  const response = await fetch(`${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/cost-usage`);
  return parseApiResponse<CostUsageResponse>(response);
}

export async function fetchStudyRuns(studyId: string): Promise<StudyRunsResponse> {
  const response = await fetch(`${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/runs`);
  return parseApiResponse<StudyRunsResponse>(response);
}

export async function applyStudyRun(
  studyId: string,
  payload: {
    workflow: WorkflowChoice;
    uploads: StudyRunUploads;
    settings: StudyRunSettings;
  }
): Promise<ApplyStudyRunResponse> {
  const response = await fetch(`${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/runs/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return parseApiResponse<ApplyStudyRunResponse>(response);
}

export async function activateStudyRun(studyId: string, runId: string): Promise<ActivateStudyRunResponse> {
  const response = await fetch(
    `${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/runs/${encodeURIComponent(runId)}/activate`,
    { method: "PATCH" }
  );
  return parseApiResponse<ActivateStudyRunResponse>(response);
}

export async function patchStudyManifest(
  studyId: string,
  patch: { workflowChoice?: WorkflowChoice; uiStage?: WizardStage; pipelineUiStep?: string }
): Promise<PatchStudyManifestResponse> {
  const response = await fetch(`${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/manifest`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch)
  });
  return parseApiResponse<PatchStudyManifestResponse>(response);
}

export async function fetchOpenAiDeployments(): Promise<OpenAiDeploymentsResponse> {
  const response = await fetch(`${API_BASE}/api/v1/config/openai-deployments`);
  return parseApiResponse<OpenAiDeploymentsResponse>(response);
}

export async function fetchPdTaxonomy(): Promise<PdTaxonomyResponse> {
  const response = await fetch(`${API_BASE}/api/v1/pd-taxonomy`);
  return parseApiResponse<PdTaxonomyResponse>(response);
}

export async function deleteStudy(studyId: string): Promise<DeleteStudyResponse> {
  const response = await fetch(`${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}`, {
    method: "DELETE"
  });
  return parseApiResponse<DeleteStudyResponse>(response);
}

export async function deleteAllStudies(): Promise<DeleteAllStudiesResponse> {
  const response = await fetch(`${API_BASE}/api/v1/studies`, {
    method: "DELETE"
  });
  return parseApiResponse<DeleteAllStudiesResponse>(response);
}

export interface ResetStudyResponse {
  studyId: string;
  deletedBlobCount: number;
  totalBlobCount: number;
  localOutputRemoved: boolean;
  message: string;
  stepStatuses: Record<string, StepStatus>;
}

export async function resetStudy(studyId: string): Promise<ResetStudyResponse> {
  const response = await fetch(`${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/reset`, {
    method: "POST"
  });
  return parseApiResponse<ResetStudyResponse>(response);
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

export async function preprocessProtocol(studyId: string): Promise<PreprocessResponse> {
  const response = await fetch(
    `${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/preprocess/protocol`,
    { method: "POST" }
  );
  return parseApiResponse<PreprocessResponse>(response);
}

export async function preprocessAcrf(studyId: string): Promise<PreprocessResponse> {
  const response = await fetch(`${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/preprocess/acrf`, {
    method: "POST"
  });
  return parseApiResponse<PreprocessResponse>(response);
}

export async function fetchStep1RunState(studyId: string): Promise<Step1RunStateResponse> {
  const response = await fetch(`${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/step1/run-state`);
  return parseApiResponse<Step1RunStateResponse>(response);
}

export async function runStep1Extraction(
  studyId: string,
  extractor: Step1PdfExtractor,
  options?: { force?: boolean }
): Promise<Step1ExtractResponse> {
  const response = await fetch(`${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/step1/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ extractor, force: options?.force === true })
  });
  return parseApiResponse<Step1ExtractResponse>(response);
}

export async function fetchStep1Preview(
  studyId: string,
  options?: { full?: boolean }
): Promise<Step1PreviewResponse> {
  const query = options?.full ? "?full=true" : "";
  const response = await fetch(
    `${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/step1/preview${query}`
  );
  return parseApiResponse<Step1PreviewResponse>(response);
}

export async function fetchSpecificationsPreview(studyId: string): Promise<SpecificationsPreviewResponse> {
  const response = await fetch(
    `${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/specifications/preview`
  );
  return parseApiResponse<SpecificationsPreviewResponse>(response);
}

export async function runStep(
  studyId: string,
  stepId: string,
  options?: {
    llmInstructions?: string;
    llmDeployment?: string;
    versionMode?: "new" | "overwrite";
    overwriteVersion?: string;
  }
): Promise<StepRunResponse> {
  const body: Record<string, string | boolean> = { force: true };
  const note = options?.llmInstructions?.trim();
  if (note) {
    body.llmInstructions = note;
  }
  const deployment = options?.llmDeployment?.trim();
  if (deployment) {
    body.llmDeployment = deployment;
  }
  if (options?.versionMode) {
    body.versionMode = options.versionMode;
  }
  const overwrite = options?.overwriteVersion?.trim();
  if (overwrite) {
    body.overwriteVersion = overwrite;
  }
  const response = await fetch(`${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/steps/${encodeURIComponent(stepId)}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return parseApiResponse<StepRunResponse>(response);
}

export interface ExtractDeviationsVersionPlanResponse {
  studyId: string;
  sourceVersions: Record<string, unknown>;
  matchingVersion: string | null;
  activeVersion: string | null;
  versionsWithSameSources: string[];
  stepStatuses: Record<string, StepStatus>;
}

export async function fetchExtractDeviationsVersionPlan(
  studyId: string
): Promise<ExtractDeviationsVersionPlanResponse> {
  const response = await fetch(
    `${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/steps/extract-deviations/version-plan`
  );
  return parseApiResponse<ExtractDeviationsVersionPlanResponse>(response);
}

export interface DedupeDeviationsPerRuleResponse {
  studyId: string;
  beforeCount: number;
  afterCount: number;
  removedCount: number;
  version: string;
  auditSummary: { mergeCount: number; removedCount: number };
  stepStatuses: Record<string, StepStatus>;
}

export async function dedupeDeviationsPerRule(
  studyId: string,
  options?: { llmDeployment?: string }
): Promise<DedupeDeviationsPerRuleResponse> {
  const body: Record<string, string> = {};
  const deployment = options?.llmDeployment?.trim();
  if (deployment) {
    body.llmDeployment = deployment;
  }
  const response = await fetch(
    `${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/steps/extract-deviations/dedupe-per-rule`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }
  );
  return parseApiResponse<DedupeDeviationsPerRuleResponse>(response);
}

export async function fetchStepPreview(
  studyId: string,
  stepId: string,
  options?: { version?: string }
): Promise<StepPreviewResponse> {
  const version = options?.version?.trim();
  const query = version ? `?version=${encodeURIComponent(version)}` : "";
  const response = await fetch(
    `${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/steps/${encodeURIComponent(stepId)}/preview${query}`
  );
  return parseApiResponse<StepPreviewResponse>(response);
}

export async function fetchStepArtifactVersions(
  studyId: string,
  stepId: string
): Promise<StepArtifactVersionsResponse> {
  const response = await fetch(
    `${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/step-artifact-versions?stepId=${encodeURIComponent(stepId)}`
  );
  return parseApiResponse<StepArtifactVersionsResponse>(response);
}

export async function setActiveStepArtifact(
  studyId: string,
  stepId: string,
  version: string
): Promise<SetActiveStepArtifactResponse> {
  const response = await fetch(
    `${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/active-step-artifact`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stepId, version })
    }
  );
  return parseApiResponse<SetActiveStepArtifactResponse>(response);
}

export async function fetchExtractionLive(studyId: string): Promise<ExtractionLiveResponse> {
  const response = await fetch(
    `${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/extraction/live`
  );
  return parseApiResponse<ExtractionLiveResponse>(response);
}

export async function fetchStep7ReviewSources(studyId: string): Promise<Step7ReviewSourcesResponse> {
  const response = await fetch(
    `${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/step7/review-sources`
  );
  return parseApiResponse<Step7ReviewSourcesResponse>(response);
}

export async function setStep7ReviewDisplaySource(
  studyId: string,
  reviewSource: Step7ReviewSource
): Promise<Step7ReviewSourcesResponse> {
  const response = await fetch(
    `${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/step7/review-sources/select`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewSource })
    }
  );
  return parseApiResponse<Step7ReviewSourcesResponse>(response);
}

export async function fetchStep7Deviations(
  studyId: string,
  reviewSource?: Step7ReviewSource
): Promise<Step7DeviationsResponse> {
  const response = await fetch(
    `${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/step7/deviations${step7ReviewQuery(reviewSource)}`
  );
  return parseApiResponse<Step7DeviationsResponse>(response);
}

export async function fetchStep7DeviationChat(studyId: string, deviationId: string): Promise<Step7DeviationChatResponse> {
  const response = await fetch(
    `${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/step7/deviations/${encodeURIComponent(deviationId)}/chat`
  );
  return parseApiResponse<Step7DeviationChatResponse>(response);
}

export interface Step7EnrichmentDetailResponse {
  studyId: string;
  deviationId: string;
  enrichment_status: string;
  enrichment_summary: string;
  enrichment_errors: Record<string, string>;
  original_deviation_text: string;
  suggested_deviation_text: string;
  improved_deviation_text: string;
  improved_pseudo_logic_plain_english: string;
  paragraph_refs?: string[];
  protocol_grounding?: Record<string, unknown>;
  acrf_grounding?: Record<string, unknown>;
  assumptions: string[];
  caveats: string[];
  data_gaps: string[];
  weak_spots: string[];
  suggested_changes: string[];
  protocol_conflicts: string[];
  programmability_risk: string;
  required_datasets: string[];
  required_fields: string[];
}

export async function fetchStep7EnrichmentDetail(
  studyId: string,
  deviationId: string
): Promise<Step7EnrichmentDetailResponse> {
  const response = await fetch(
    `${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/step7/deviations/${encodeURIComponent(deviationId)}/enrichment`
  );
  return parseApiResponse<Step7EnrichmentDetailResponse>(response);
}

export async function refineStep7Deviation(
  studyId: string,
  deviationId: string,
  message: string,
  runRevisionCycle = true,
  alsoPseudo = false,
  reviewSource?: Step7ReviewSource,
  llmDeployment?: string
): Promise<Step7RefineResponse> {
  const body: Record<string, unknown> = { message, runRevisionCycle, alsoPseudo };
  const deployment = llmDeployment?.trim();
  if (deployment) {
    body.llmDeployment = deployment;
  }
  const response = await fetch(
    `${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/step7/deviations/${encodeURIComponent(deviationId)}/refine`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: step7ReviewJsonBody(body, reviewSource)
    }
  );
  return parseApiResponse<Step7RefineResponse>(response);
}

export async function updateStep7DeviationStatus(
  studyId: string,
  deviationId: string,
  status: Step7DeviationRow["status"],
  dmComment?: string,
  reviewSource?: Step7ReviewSource
): Promise<Step7UpdateResponse> {
  const response = await fetch(
    `${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/step7/deviations/${encodeURIComponent(deviationId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: step7ReviewJsonBody({ status, dmComment }, reviewSource)
    }
  );
  return parseApiResponse<Step7UpdateResponse>(response);
}

export async function acceptStep7DeviationEnriched(
  studyId: string,
  deviationId: string,
  suggestedText: string,
  reviewSource?: Step7ReviewSource
): Promise<Step7UpdateResponse> {
  return updateStep7Deviation(
    studyId,
    deviationId,
    { status: "accepted", text: suggestedText },
    reviewSource
  );
}

export async function createStep7Deviation(
  studyId: string,
  payload: Step7DeviationPayload,
  reviewSource?: Step7ReviewSource
): Promise<Step7DeviationListMutationResponse> {
  const response = await fetch(`${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/step7/deviations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: step7ReviewJsonBody(payload, reviewSource)
  });
  return parseApiResponse<Step7DeviationListMutationResponse>(response);
}

export async function updateStep7Deviation(
  studyId: string,
  deviationId: string,
  payload: Partial<Step7DeviationPayload>,
  reviewSource?: Step7ReviewSource
): Promise<Step7UpdateResponse> {
  const response = await fetch(
    `${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/step7/deviations/${encodeURIComponent(deviationId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: step7ReviewJsonBody(payload, reviewSource)
    }
  );
  return parseApiResponse<Step7UpdateResponse>(response);
}

export async function deleteStep7Deviation(
  studyId: string,
  deviationId: string,
  reviewSource?: Step7ReviewSource
): Promise<Step7DeviationListMutationResponse> {
  const response = await fetch(
    `${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/step7/deviations/${encodeURIComponent(deviationId)}${step7ReviewQuery(reviewSource)}`,
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

export async function exportStep7DeviationsWorkbook(
  studyId: string,
  reviewSource?: Step7ReviewSource
): Promise<Step7ExportWorkbookResult> {
  const response = await fetch(
    `${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/step7/deviations/export${step7ReviewQuery(reviewSource)}`
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

export async function exportStep7DeviationsCodingCsv(
  studyId: string,
  reviewSource?: Step7ReviewSource
): Promise<Step7ExportWorkbookResult> {
  const response = await fetch(
    `${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/step7/deviations/export/coding.csv${step7ReviewQuery(reviewSource)}`
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
    `${studyId}_company_pds.csv`
  );
  return { blob, fileName };
}

export async function exportStep7DeviationsCodingWorkbook(
  studyId: string,
  reviewSource?: Step7ReviewSource
): Promise<Step7ExportWorkbookResult> {
  const response = await fetch(
    `${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/step7/deviations/export/coding${step7ReviewQuery(reviewSource)}`
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
    `${studyId}_company_pds.xlsx`
  );
  return { blob, fileName };
}

export async function importStep7DeviationsWorkbook(
  studyId: string,
  workbook: File,
  reviewSource?: Step7ReviewSource
): Promise<Step7DeviationListMutationResponse> {
  const formData = new FormData();
  formData.append("workbook", workbook);
  const response = await fetch(
    `${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/step7/deviations/import${step7ReviewQuery(reviewSource)}`,
    {
      method: "POST",
      body: formData
    }
  );
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
  deviationId: string,
  reviewSource?: Step7ReviewSource
): Promise<Step7PseudoLogicSingleResponse> {
  const response = await fetch(
    `${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/step7/deviations/${encodeURIComponent(deviationId)}/pseudo-logic`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: step7ReviewJsonBody({}, reviewSource)
    }
  );
  return parseApiResponse<Step7PseudoLogicSingleResponse>(response);
}

export async function acceptStep7DeviationsAll(
  studyId: string,
  reviewSource?: Step7ReviewSource
): Promise<Step7AcceptAllResponse> {
  const response = await fetch(
    `${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/step7/deviations/accept-all`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: step7ReviewJsonBody({}, reviewSource)
    }
  );
  return parseApiResponse<Step7AcceptAllResponse>(response);
}

export async function generateStep7PseudoLogicAll(
  studyId: string,
  reviewSource?: Step7ReviewSource
): Promise<Step7PseudoLogicBulkResponse> {
  const response = await fetch(
    `${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/step7/pseudo-logic/generate-all`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: step7ReviewJsonBody({}, reviewSource)
    }
  );
  return parseApiResponse<Step7PseudoLogicBulkResponse>(response);
}

export interface SetEntryModeResponse {
  studyId: string;
  entryMode: EntryMode;
  stepStatuses: Record<string, StepStatus>;
}

export async function setStudyEntryMode(studyId: string, entryMode: EntryMode): Promise<SetEntryModeResponse> {
  const response = await fetch(`${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/entry-mode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entryMode })
  });
  return parseApiResponse<SetEntryModeResponse>(response);
}

export interface UploadPdSpecResponse {
  studyId: string;
  pdSpecPath: string;
  pdSpecBlob: string;
  pdSpecFileName?: string;
  pdSpecSize?: number;
  entryMode: EntryMode;
  stepStatuses: Record<string, StepStatus>;
}

export async function uploadPdSpecWorkbook(studyId: string, file: File): Promise<UploadPdSpecResponse> {
  const formData = new FormData();
  formData.append("workbook", file);
  const response = await fetch(`${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/upload-pd-spec`, {
    method: "POST",
    body: formData
  });
  return parseApiResponse<UploadPdSpecResponse>(response);
}

export interface ImportVersionsResponse {
  studyId: string;
  activeDeviationsSource?: string | null;
  importVersions: ImportVersionsInfo;
  sources: ImportSourceOption[];
}

export async function fetchImportVersions(studyId: string): Promise<ImportVersionsResponse> {
  const response = await fetch(`${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/import-versions`);
  return parseApiResponse<ImportVersionsResponse>(response);
}

export interface SetActiveDeviationsSourceResponse {
  studyId: string;
  activeDeviationsSource: string;
  deviationCount: number;
  stepStatuses: Record<string, StepStatus>;
}

export async function setActiveDeviationsSource(
  studyId: string,
  activeDeviationsSource: string
): Promise<SetActiveDeviationsSourceResponse> {
  const response = await fetch(
    `${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/active-deviations-source`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activeDeviationsSource })
    }
  );
  return parseApiResponse<SetActiveDeviationsSourceResponse>(response);
}

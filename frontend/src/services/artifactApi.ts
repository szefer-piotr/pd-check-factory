/**
 * Full-content artifact endpoints:
 * - GET  /api/v1/studies/{id}/artifacts/raw?doc=protocol|acrf   (PDF bytes)
 * - GET  /api/v1/studies/{id}/artifacts/text?artifact=<key>     (full text/JSON)
 * - HEAD /api/v1/studies/{id}/artifacts/text?artifact=<key>     (size check)
 */

const API_BASE = (import.meta.env.VITE_PD_API_BASE as string | undefined) ?? "http://127.0.0.1:8787";

export type RawPdfDoc = "protocol" | "acrf";

/** Whitelisted artifact keys understood by the backend artifact/text endpoint. */
export type ArtifactKey =
  | "protocol-md"
  | "acrf-md"
  | "protocol-md-layout"
  | "protocol-md-odl"
  | "acrf-md-layout"
  | "acrf-md-odl"
  | "paragraphs-md"
  | "paragraph-index"
  | "acrf-sections-manifest"
  | "acrf-summary-merged"
  | "rules-parsed"
  | "rules-raw"
  | "deviations-parsed"
  | "deviations-raw"
  | "deviations-review-state"
  | "pseudo-logic-validated"
  | "final-deviations"
  | `acrf-section:${string}`
  | `analyze-result:${RawPdfDoc}`
  | `coding-context:${string}`
  | `coding-enrichment:${string}`;

export interface ArtifactMeta {
  size: number;
  contentType: string;
}

export class ArtifactNotFoundError extends Error {
  constructor(artifact: string) {
    super(`Artifact '${artifact}' not found.`);
    this.name = "ArtifactNotFoundError";
  }
}

function artifactTextUrl(studyId: string, artifact: ArtifactKey): string {
  return `${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/artifacts/text?artifact=${encodeURIComponent(artifact)}`;
}

export function artifactRawPdfUrl(studyId: string, doc: RawPdfDoc): string {
  return `${API_BASE}/api/v1/studies/${encodeURIComponent(studyId)}/artifacts/raw?doc=${encodeURIComponent(doc)}`;
}

async function throwArtifactError(response: Response, artifact: string): Promise<never> {
  if (response.status === 404) {
    throw new ArtifactNotFoundError(artifact);
  }
  let message = `HTTP ${response.status}`;
  try {
    const parsed = (await response.json()) as { error?: { message?: string } };
    message = parsed.error?.message ?? message;
  } catch {
    // non-JSON error body
  }
  throw new Error(message);
}

/** HEAD request: size + content type without downloading the body. */
export async function fetchArtifactMeta(studyId: string, artifact: ArtifactKey): Promise<ArtifactMeta> {
  const response = await fetch(artifactTextUrl(studyId, artifact), { method: "HEAD" });
  if (!response.ok) {
    if (response.status === 404) {
      throw new ArtifactNotFoundError(artifact);
    }
    throw new Error(`HTTP ${response.status}`);
  }
  return {
    size: Number(response.headers.get("Content-Length") ?? "0"),
    contentType: response.headers.get("Content-Type") ?? "text/plain"
  };
}

export async function fetchArtifactText(studyId: string, artifact: ArtifactKey): Promise<string> {
  const response = await fetch(artifactTextUrl(studyId, artifact));
  if (!response.ok) {
    await throwArtifactError(response, artifact);
  }
  return response.text();
}

export async function fetchArtifactJson<T>(studyId: string, artifact: ArtifactKey): Promise<T> {
  const text = await fetchArtifactText(studyId, artifact);
  return JSON.parse(text) as T;
}

export function formatByteSize(bytes: number): string {
  if (!bytes) {
    return "0 B";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ---- Artifact JSON shapes (subset of fields the UI uses) ---- */

export interface ParagraphIndexEntry {
  paragraph_id: string;
  text: string;
  char_start: number;
  char_end: number;
}

export interface ParagraphIndexJson {
  study_id: string;
  generated_at?: string;
  paragraphs: ParagraphIndexEntry[];
}

export interface AcrfSectionEntry {
  name: string;
  code: string;
  toc_page: number;
  start_line?: number;
  end_line?: number;
}

export interface AcrfSectionsManifestJson {
  source_md?: string;
  sections: AcrfSectionEntry[];
}

export interface AcrfDatasetColumn {
  column_name: string;
  column_description?: string;
  column_values?: string;
}

export interface AcrfDatasetEntry {
  dataset_name: string;
  columns: AcrfDatasetColumn[];
}

export interface AcrfSummaryMergedJson {
  study_id: string;
  generated_at?: string;
  datasets: AcrfDatasetEntry[];
}

export interface RuleEntry {
  rule_id: string;
  title: string;
  text: string;
  paragraph_refs: string[];
  coverage_note?: string;
}

export interface RulesParsedJson {
  study_id: string;
  generated_at?: string;
  rules: RuleEntry[];
}

export interface DeviationEntry {
  deviation_id: string;
  rule_id: string;
  text: string;
  paragraph_refs: string[];
  data_support_note?: string;
  status?: string;
  dm_comment?: string;
}

export interface DeviationsParsedJson {
  study_id: string;
  generated_at?: string;
  deviations: DeviationEntry[];
}

/** Derives the markdown section file name used by the aCRF split step. */
export function acrfSectionFileName(section: AcrfSectionEntry): string {
  const page = String(section.toc_page).padStart(3, "0");
  const label = section.code ? `${section.code}_${section.name}` : section.name;
  const slug = label
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return `${page}_${slug || "section"}.md`;
}

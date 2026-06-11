import { fetchArtifactJson, type ParagraphIndexJson } from "./artifactApi";

const cache = new Map<string, Promise<Map<string, string>>>();

/** Memoized paragraph_id → text map per study (for inline evidence rendering). */
export function getParagraphTextMap(studyId: string): Promise<Map<string, string>> {
  const key = studyId.trim();
  const existing = cache.get(key);
  if (existing) {
    return existing;
  }
  const loading = fetchArtifactJson<ParagraphIndexJson>(key, "paragraph-index")
    .then((index) => new Map((index.paragraphs ?? []).map((paragraph) => [paragraph.paragraph_id, paragraph.text])))
    .catch(() => {
      cache.delete(key);
      return new Map<string, string>();
    });
  cache.set(key, loading);
  return loading;
}

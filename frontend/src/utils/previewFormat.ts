export function tryParseJson(body: string): unknown | null {
  const trimmed = body.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return null;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

export function isFileListPreview(title: string, body: string): boolean {
  const lower = title.toLowerCase();
  return lower.includes("section") && lower.includes("file") && body.includes("\n");
}

export function parseFileList(body: string): string[] {
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export interface RulePreviewRow {
  rule_id: string;
  title: string;
  text: string;
}

export interface DeviationPreviewRow {
  deviation_id: string;
  rule_id: string;
  text: string;
}

export function extractRulesFromJson(data: unknown, limit = 12): RulePreviewRow[] {
  const rules = extractArray(data, ["rules"]);
  return rules.slice(0, limit).map((item, index) => {
    const row = item as Record<string, unknown>;
    return {
      rule_id: String(row.rule_id ?? row.id ?? `rule-${index + 1}`),
      title: String(row.title ?? row.rule_title ?? ""),
      text: truncate(String(row.text ?? ""), 120)
    };
  });
}

export function extractDeviationsFromJson(data: unknown, limit = 12): DeviationPreviewRow[] {
  const deviations = extractArray(data, ["deviations", "items"]);
  return deviations.slice(0, limit).map((item, index) => {
    const row = item as Record<string, unknown>;
    return {
      deviation_id: String(row.deviation_id ?? row.id ?? `dev-${index + 1}`),
      rule_id: String(row.rule_id ?? ""),
      text: truncate(String(row.text ?? row.deviation_text ?? ""), 120)
    };
  });
}

function extractArray(data: unknown, keys: string[]): unknown[] {
  if (Array.isArray(data)) {
    return data;
  }
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    for (const key of keys) {
      const value = obj[key];
      if (Array.isArray(value)) {
        return value;
      }
    }
  }
  return [];
}

function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}…`;
}

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

export interface AcrfSummaryPreviewRow {
  dataset_name: string;
  column_name: string;
  column_description: string;
  column_values: string;
}

export function extractRulesFromJson(data: unknown): RulePreviewRow[] {
  const rules = extractArray(data, ["rules"]);
  return rules.map((item, index) => {
    const row = item as Record<string, unknown>;
    return {
      rule_id: String(row.rule_id ?? row.id ?? `rule-${index + 1}`),
      title: String(row.title ?? row.rule_title ?? ""),
      text: String(row.text ?? "")
    };
  });
}

export function extractDeviationsFromJson(data: unknown): DeviationPreviewRow[] {
  const deviations = extractArray(data, ["deviations", "items"]);
  return deviations.map((item, index) => {
    const row = item as Record<string, unknown>;
    return {
      deviation_id: String(row.deviation_id ?? row.id ?? `dev-${index + 1}`),
      rule_id: String(row.rule_id ?? ""),
      text: String(row.text ?? row.deviation_text ?? "")
    };
  });
}

export function extractAcrfSummaryFromJson(data: unknown): AcrfSummaryPreviewRow[] {
  const datasets = extractArray(data, ["datasets"]);
  const rows: AcrfSummaryPreviewRow[] = [];
  for (const item of datasets) {
    const dataset = item as Record<string, unknown>;
    const datasetName = String(dataset.dataset_name ?? dataset.name ?? "");
    const columns = Array.isArray(dataset.columns) ? dataset.columns : [];
    for (const columnItem of columns) {
      const column = columnItem as Record<string, unknown>;
      rows.push({
        dataset_name: datasetName || "—",
        column_name: String(column.column_name ?? column.name ?? ""),
        column_description: String(column.column_description ?? column.notes ?? ""),
        column_values: formatColumnValues(column)
      });
    }
  }
  return rows;
}

function formatColumnValues(column: Record<string, unknown>): string {
  if (column.column_values != null && String(column.column_values).trim()) {
    return String(column.column_values);
  }
  const allowed = column.allowed_values ?? column.categorical_values;
  if (Array.isArray(allowed) && allowed.length > 0) {
    return allowed.map(String).join(", ");
  }
  const valueRange = column.value_range;
  if (valueRange && typeof valueRange === "object") {
    const range = valueRange as Record<string, unknown>;
    const min = String(range.min ?? "");
    const max = String(range.max ?? "");
    if (min || max) {
      return [min && `min: ${min}`, max && `max: ${max}`].filter(Boolean).join(", ");
    }
  }
  return "";
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

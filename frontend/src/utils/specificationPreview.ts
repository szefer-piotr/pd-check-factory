import type {
  SpecificationPreviewDeviationRow,
  SpecificationPreviewRow,
  SpecificationPreviewSource
} from "../services/stepApi";

export function isSpreadsheetPreviewSource(
  source: SpecificationPreviewSource | undefined
): source is SpecificationPreviewSource & { columns: string[]; rows: Array<Record<string, string>> } {
  return Boolean(source?.columns?.length);
}

export function isDeviationPreviewRow(row: SpecificationPreviewRow): row is SpecificationPreviewDeviationRow {
  return "deviation_id" in row;
}

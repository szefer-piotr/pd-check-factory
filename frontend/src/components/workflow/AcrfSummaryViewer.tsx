import { useEffect, useMemo, useState } from "react";
import { fetchStep1Preview, fetchStepPreview } from "../../services/stepApi";
import {
  extractAcrfSummaryFromJson,
  tryParseJson,
  type AcrfSummaryPreviewRow
} from "../../utils/previewFormat";
import { AcrfSummaryPreview } from "./preview/AcrfSummaryPreview";
import { MarkdownPreview } from "./MarkdownPreview";

interface AcrfSummaryViewerProps {
  studyId: string;
  /** Optional free-text hint (e.g. data_support_note) used to filter datasets. */
  focusHint?: string;
}

export function AcrfSummaryViewer({ studyId, focusHint = "" }: AcrfSummaryViewerProps): JSX.Element {
  const [rows, setRows] = useState<AcrfSummaryPreviewRow[]>([]);
  const [markdownFallback, setMarkdownFallback] = useState("");
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const trimmed = studyId.trim();
    if (!trimmed) {
      setRows([]);
      setMarkdownFallback("");
      return;
    }
    let cancelled = false;
    async function load(): Promise<void> {
      setLoading(true);
      setError("");
      try {
        const preview = await fetchStepPreview(trimmed, "acrf-summary-text");
        if (cancelled) {
          return;
        }
        const body = preview.previews[0]?.body ?? "";
        const parsed = tryParseJson(body);
        const extracted = parsed ? extractAcrfSummaryFromJson(parsed) : [];
        if (extracted.length > 0) {
          setRows(extracted);
          setMarkdownFallback("");
          return;
        }
        const step1 = await fetchStep1Preview(trimmed, { full: true });
        if (cancelled) {
          return;
        }
        setRows([]);
        setMarkdownFallback(step1.acrfPreview?.trim() || "");
        if (!step1.acrfExists || !step1.acrfPreview?.trim()) {
          setError("No aCRF summary or extracted text available yet. Finish document preprocessing first.");
        }
      } catch (loadError) {
        if (!cancelled) {
          setRows([]);
          setMarkdownFallback("");
          setError(loadError instanceof Error ? loadError.message : "Unable to load aCRF preview.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [studyId]);

  useEffect(() => {
    if (focusHint.trim()) {
      setFilter(focusHint.trim());
    }
  }, [focusHint]);

  const filteredRows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q || rows.length === 0) {
      return rows;
    }
    const tokens = q.split(/[\s,;/|]+/).filter((token) => token.length >= 2);
    if (tokens.length === 0) {
      return rows;
    }
    return rows.filter((row) => {
      const haystack = `${row.dataset_name} ${row.column_name} ${row.column_description} ${row.column_values}`.toLowerCase();
      return tokens.some((token) => haystack.includes(token));
    });
  }, [filter, rows]);

  return (
    <div className="acrf-summary-viewer">
      <div className="acrf-summary-viewer-toolbar">
        <label className="pipeline-field acrf-summary-filter">
          <span className="visually-hidden">Filter aCRF datasets</span>
          <input
            type="search"
            className="input"
            placeholder="Filter by dataset, column…"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </label>
        {rows.length > 0 ? (
          <span className="chip">
            {filteredRows.length === rows.length
              ? `${rows.length} columns`
              : `${filteredRows.length} / ${rows.length}`}
          </span>
        ) : null}
      </div>

      <div className="acrf-summary-viewer-body">
        {loading ? <p className="step7-muted">Loading aCRF preview…</p> : null}
        {error ? <p className="pipeline-error">{error}</p> : null}
        {!loading && !error && rows.length > 0 ? <AcrfSummaryPreview rows={filteredRows} /> : null}
        {!loading && !error && rows.length === 0 && markdownFallback ? (
          <MarkdownPreview content={markdownFallback} />
        ) : null}
      </div>
    </div>
  );
}

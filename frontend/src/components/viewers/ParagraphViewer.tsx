import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArtifactNotFoundError,
  fetchArtifactJson,
  type ParagraphIndexEntry,
  type ParagraphIndexJson
} from "../../services/artifactApi";
import { buildHash } from "../../utils/hashRoute";

interface ParagraphViewerProps {
  studyId: string;
  /** Paragraph id (e.g. "p154") to scroll to and highlight. */
  focusRef?: string;
  /** Additional paragraph ids to mark (e.g. the refs of a selected rule). */
  highlightRefs?: string[];
  /** Viewer height; defaults to a tall scroll area. */
  height?: string;
  emptyMessage?: string;
}

/**
 * The canonical numbered paragraph viewer (p1: …), virtualized with search and
 * anchor deep links. Embedded by the index, rules, deviations, and review steps.
 */
export function ParagraphViewer({
  studyId,
  focusRef,
  highlightRefs = [],
  height = "100%",
  emptyMessage = "Paragraph index not generated yet. Run the index-protocol step."
}: ParagraphViewerProps): JSX.Element {
  const [paragraphs, setParagraphs] = useState<ParagraphIndexEntry[] | null>(null);
  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [query, setQuery] = useState("");
  const [copiedRef, setCopiedRef] = useState("");
  const [flashRef, setFlashRef] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setParagraphs(null);
    setError("");
    setNotFound(false);
    if (!studyId.trim()) {
      return;
    }
    fetchArtifactJson<ParagraphIndexJson>(studyId.trim(), "paragraph-index")
      .then((index) => {
        if (!cancelled) {
          setParagraphs(index.paragraphs ?? []);
        }
      })
      .catch((loadError) => {
        if (cancelled) {
          return;
        }
        if (loadError instanceof ArtifactNotFoundError) {
          setNotFound(true);
        } else {
          setError(loadError instanceof Error ? loadError.message : "Unable to load paragraph index.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [studyId]);

  const highlightSet = useMemo(() => new Set(highlightRefs), [highlightRefs]);

  const visible = useMemo(() => {
    if (!paragraphs) {
      return [];
    }
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) {
      return paragraphs;
    }
    return paragraphs.filter(
      (paragraph) =>
        paragraph.paragraph_id.toLowerCase() === trimmed ||
        paragraph.text.toLowerCase().includes(trimmed)
    );
  }, [paragraphs, query]);

  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 72,
    overscan: 12
  });

  useEffect(() => {
    if (!focusRef || !paragraphs || visible.length === 0) {
      return;
    }
    const index = visible.findIndex((paragraph) => paragraph.paragraph_id === focusRef);
    if (index < 0) {
      return;
    }
    virtualizer.scrollToIndex(index, { align: "center" });
    setFlashRef(focusRef);
    const timer = window.setTimeout(() => setFlashRef(""), 2500);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRef, paragraphs, visible.length]);

  async function copyAnchor(refId: string): Promise<void> {
    const anchor = `${window.location.origin}${window.location.pathname}#${buildHash("index-protocol", { focus: refId })}`;
    try {
      await navigator.clipboard.writeText(anchor);
      setCopiedRef(refId);
      window.setTimeout(() => setCopiedRef(""), 1500);
    } catch {
      // clipboard unavailable
    }
  }

  if (error) {
    return <p className="step1-error">{error}</p>;
  }
  if (notFound) {
    return <p className="step7-muted">{emptyMessage}</p>;
  }
  if (!paragraphs) {
    return <p className="step1-status">Loading paragraph index…</p>;
  }

  return (
    <div className="paragraph-viewer" style={{ height }}>
      <div className="paragraph-viewer-toolbar">
        <input
          className="input paragraph-viewer-search"
          type="search"
          placeholder="Search paragraphs (text or p#)…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search paragraphs"
        />
        <span className="chip">
          {query.trim() ? `${visible.length} / ${paragraphs.length}` : paragraphs.length} paragraphs
        </span>
      </div>
      <div className="paragraph-viewer-scroll" ref={scrollRef}>
        <div className="paragraph-viewer-inner" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const paragraph = visible[item.index];
            const isFlash = paragraph.paragraph_id === flashRef;
            const isMarked = highlightSet.has(paragraph.paragraph_id);
            return (
              <div
                key={paragraph.paragraph_id}
                data-index={item.index}
                ref={virtualizer.measureElement}
                className={`paragraph-row ${isMarked ? "paragraph-row-marked" : ""} ${isFlash ? "paragraph-row-flash" : ""}`}
                style={{ transform: `translateY(${item.start}px)` }}
              >
                <button
                  type="button"
                  className="paragraph-row-anchor"
                  title={copiedRef === paragraph.paragraph_id ? "Link copied" : "Copy link to this paragraph"}
                  onClick={() => void copyAnchor(paragraph.paragraph_id)}
                >
                  {copiedRef === paragraph.paragraph_id ? "✓" : paragraph.paragraph_id}
                </button>
                <p className="paragraph-row-text">{paragraph.text}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

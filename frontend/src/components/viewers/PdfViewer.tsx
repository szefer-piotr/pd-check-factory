import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { PDFDocumentProxy, PDFDocumentLoadingTask, RenderTask } from "pdfjs-dist";

/** pdf.js is loaded lazily: it is heavy and crashes in non-browser (test) environments. */
async function loadPdfjs(): Promise<typeof import("pdfjs-dist")> {
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url")
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

const THUMB_WIDTH = 110;

interface PdfPageCanvasProps {
  doc: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
}

function PdfPageCanvas({ doc, pageNumber, scale }: PdfPageCanvasProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let renderTask: RenderTask | null = null;
    void doc.getPage(pageNumber).then((page) => {
      if (cancelled) {
        return;
      }
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      if (!canvas || !context) {
        return;
      }
      const viewport = page.getViewport({ scale });
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      renderTask = page.render({
        canvas,
        canvasContext: context,
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined
      });
      renderTask.promise.catch(() => {
        // cancelled renders are expected while scrolling/zooming
      });
    });
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [doc, pageNumber, scale]);

  return <canvas ref={canvasRef} className="pdf-page-canvas" aria-label={`Page ${pageNumber}`} />;
}

interface PdfThumbProps {
  doc: PDFDocumentProxy;
  pageNumber: number;
  isActive: boolean;
  onSelect: (pageNumber: number) => void;
}

function PdfThumb({ doc, pageNumber, isActive, onSelect }: PdfThumbProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLButtonElement | null>(null);
  const renderedRef = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting) || renderedRef.current) {
        return;
      }
      renderedRef.current = true;
      void doc.getPage(pageNumber).then((page) => {
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context) {
          return;
        }
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = THUMB_WIDTH / baseViewport.width;
        const viewport = page.getViewport({ scale });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        page.render({ canvas, canvasContext: context, viewport }).promise.catch(() => {});
      });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [doc, pageNumber]);

  return (
    <button
      ref={containerRef}
      type="button"
      className={`pdf-thumb ${isActive ? "pdf-thumb-active" : ""}`}
      onClick={() => onSelect(pageNumber)}
    >
      <canvas ref={canvasRef} className="pdf-thumb-canvas" />
      <span className="pdf-thumb-label">{pageNumber}</span>
    </button>
  );
}

interface PdfSearchMatch {
  pageNumber: number;
  snippet: string;
}

interface PdfViewerProps {
  /** URL serving the raw PDF bytes (artifactRawPdfUrl). */
  url: string;
  initialPage?: number;
  height?: string;
}

/**
 * Full-document PDF viewer (pdf.js): virtualized page list, thumbnail sidebar,
 * zoom, text search, and go-to-page.
 */
export function PdfViewer({ url, initialPage, height = "100%" }: PdfViewerProps): JSX.Element {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState("");
  const [scale, setScale] = useState(1.1);
  const [basePageHeight, setBasePageHeight] = useState(842);
  const [currentPage, setCurrentPage] = useState(initialPage ?? 1);
  const [pageInput, setPageInput] = useState(String(initialPage ?? 1));
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<PdfSearchMatch[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [showThumbs, setShowThumbs] = useState(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textCacheRef = useRef<Map<number, string>>(new Map());

  useEffect(() => {
    let cancelled = false;
    setDoc(null);
    setError("");
    setMatches(null);
    textCacheRef.current = new Map();
    let loadingTask: PDFDocumentLoadingTask | null = null;
    loadPdfjs()
      .then((pdfjs) => {
        if (cancelled) {
          return null;
        }
        loadingTask = pdfjs.getDocument({ url });
        return loadingTask.promise;
      })
      .then(async (loaded) => {
        if (!loaded || cancelled) {
          return;
        }
        const firstPage = await loaded.getPage(1);
        if (cancelled) {
          return;
        }
        setBasePageHeight(firstPage.getViewport({ scale: 1 }).height);
        setDoc(loaded);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          const message = loadError instanceof Error ? loadError.message : "Unable to load PDF.";
          setError(/404|not found/i.test(message) ? "PDF not uploaded yet." : message);
        }
      });
    return () => {
      cancelled = true;
      void loadingTask?.destroy();
    };
  }, [url]);

  const numPages = doc?.numPages ?? 0;
  const estimatedRowHeight = Math.ceil(basePageHeight * scale) + 18;

  const virtualizer = useVirtualizer({
    count: numPages,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimatedRowHeight,
    overscan: 2
  });

  useEffect(() => {
    virtualizer.measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale, estimatedRowHeight]);

  const goToPage = useCallback(
    (pageNumber: number) => {
      if (!numPages) {
        return;
      }
      const clamped = Math.max(1, Math.min(numPages, pageNumber));
      setCurrentPage(clamped);
      setPageInput(String(clamped));
      virtualizer.scrollToIndex(clamped - 1, { align: "start" });
    },
    [numPages, virtualizer]
  );

  useEffect(() => {
    if (doc && initialPage && initialPage > 1) {
      goToPage(initialPage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  // Track the topmost visible page for the toolbar indicator.
  const virtualItems = virtualizer.getVirtualItems();
  useEffect(() => {
    if (virtualItems.length === 0) {
      return;
    }
    const scrollTop = scrollRef.current?.scrollTop ?? 0;
    const top = virtualItems.find((item) => item.start + item.size > scrollTop) ?? virtualItems[0];
    const pageNumber = top.index + 1;
    setCurrentPage((previous) => (previous === pageNumber ? previous : pageNumber));
    setPageInput((previous) => (previous === String(pageNumber) ? previous : String(pageNumber)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [virtualItems.map((item) => item.index).join(",")]);

  const pageText = useCallback(
    async (pageNumber: number): Promise<string> => {
      const cached = textCacheRef.current.get(pageNumber);
      if (cached !== undefined) {
        return cached;
      }
      if (!doc) {
        return "";
      }
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ");
      textCacheRef.current.set(pageNumber, text);
      return text;
    },
    [doc]
  );

  async function runSearch(): Promise<void> {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed || !doc) {
      setMatches(null);
      return;
    }
    setIsSearching(true);
    try {
      const found: PdfSearchMatch[] = [];
      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
        const text = await pageText(pageNumber);
        const lower = text.toLowerCase();
        let from = 0;
        while (found.length < 200) {
          const at = lower.indexOf(trimmed, from);
          if (at < 0) {
            break;
          }
          const start = Math.max(0, at - 40);
          found.push({
            pageNumber,
            snippet: `…${text.slice(start, at + trimmed.length + 40)}…`
          });
          from = at + trimmed.length;
        }
        if (found.length >= 200) {
          break;
        }
      }
      setMatches(found);
    } finally {
      setIsSearching(false);
    }
  }

  const thumbs = useMemo(() => Array.from({ length: numPages }, (_, index) => index + 1), [numPages]);

  if (error) {
    return <p className="step7-muted pdf-viewer-error">{error}</p>;
  }
  if (!doc) {
    return <p className="step1-status">Loading PDF…</p>;
  }

  return (
    <div className="pdf-viewer" style={{ height }}>
      <div className="pdf-viewer-toolbar">
        <button type="button" className="button button-ghost" onClick={() => setShowThumbs((value) => !value)}>
          {showThumbs ? "Hide pages" : "Show pages"}
        </button>
        <span className="pdf-toolbar-group">
          <button type="button" className="button button-ghost" onClick={() => setScale((value) => Math.max(0.5, +(value - 0.2).toFixed(2)))}>
            −
          </button>
          <span className="step7-muted pdf-zoom-label">{Math.round(scale * 100)}%</span>
          <button type="button" className="button button-ghost" onClick={() => setScale((value) => Math.min(3, +(value + 0.2).toFixed(2)))}>
            +
          </button>
        </span>
        <span className="pdf-toolbar-group">
          <input
            className="input pdf-page-input"
            value={pageInput}
            onChange={(event) => setPageInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                goToPage(Number(pageInput) || 1);
              }
            }}
            aria-label="Go to page"
          />
          <span className="step7-muted">/ {numPages}</span>
        </span>
        <span className="pdf-toolbar-group pdf-toolbar-search">
          <input
            className="input"
            type="search"
            placeholder="Search text…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void runSearch();
              }
            }}
            aria-label="Search PDF text"
          />
          <button type="button" className="button button-ghost" onClick={() => void runSearch()} disabled={isSearching}>
            {isSearching ? "Searching…" : "Search"}
          </button>
        </span>
      </div>
      <div className="pdf-viewer-body">
        {showThumbs ? (
          <div className="pdf-thumbs" aria-label="Page thumbnails">
            {thumbs.map((pageNumber) => (
              <PdfThumb
                key={pageNumber}
                doc={doc}
                pageNumber={pageNumber}
                isActive={pageNumber === currentPage}
                onSelect={goToPage}
              />
            ))}
          </div>
        ) : null}
        <div className="pdf-pages-scroll" ref={scrollRef}>
          <div className="pdf-pages-inner" style={{ height: virtualizer.getTotalSize() }}>
            {virtualItems.map((item) => (
              <div
                key={item.index}
                data-index={item.index}
                ref={virtualizer.measureElement}
                className="pdf-page-row"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                <PdfPageCanvas doc={doc} pageNumber={item.index + 1} scale={scale} />
              </div>
            ))}
          </div>
        </div>
        {matches !== null ? (
          <aside className="pdf-search-results" aria-label="Search results">
            <div className="pdf-search-results-header">
              <strong>{matches.length} matches</strong>
              <button type="button" className="button button-ghost" onClick={() => setMatches(null)}>
                Close
              </button>
            </div>
            {matches.length === 0 ? <p className="step7-muted">No matches found.</p> : null}
            <ul className="pdf-search-results-list">
              {matches.map((match, index) => (
                <li key={`${match.pageNumber}-${index}`}>
                  <button type="button" className="pdf-search-result" onClick={() => goToPage(match.pageNumber)}>
                    <span className="pdf-search-result-page">p. {match.pageNumber}</span>
                    <span className="pdf-search-result-snippet">{match.snippet}</span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>
        ) : null}
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArtifactNotFoundError,
  fetchArtifactMeta,
  fetchArtifactText,
  formatByteSize,
  type ArtifactKey
} from "../../services/artifactApi";

const SIZE_WARN_BYTES = 2 * 1024 * 1024;
const MAX_CHUNK_LINES = 120;

interface MarkdownChunk {
  id: number;
  text: string;
  /** Headings starting this chunk (level + title) for the outline. */
  heading?: { level: number; title: string };
}

function chunkMarkdown(content: string): MarkdownChunk[] {
  const lines = content.split("\n");
  const chunks: MarkdownChunk[] = [];
  let current: string[] = [];
  let currentHeading: MarkdownChunk["heading"];
  let inFence = false;

  const flush = (): void => {
    if (current.length === 0) {
      return;
    }
    chunks.push({ id: chunks.length, text: current.join("\n"), heading: currentHeading });
    current = [];
    currentHeading = undefined;
  };

  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
    }
    const headingMatch = !inFence ? /^(#{1,4})\s+(.*)$/.exec(line) : null;
    if (headingMatch && current.length > 0) {
      flush();
    }
    if (headingMatch && current.length === 0) {
      currentHeading = { level: headingMatch[1].length, title: headingMatch[2].trim() };
    }
    current.push(line);
    if (!inFence && current.length >= MAX_CHUNK_LINES && line.trim() === "") {
      flush();
    }
  }
  flush();
  return chunks;
}

interface MarkdownViewerProps {
  studyId: string;
  artifact: ArtifactKey;
  /** Direct content instead of fetching (e.g. already-loaded section markdown). */
  content?: string;
  height?: string;
  showOutline?: boolean;
  emptyMessage?: string;
}

/**
 * Full-content markdown viewer: virtualized chunk rendering, heading outline,
 * find-in-document, and a size gate for multi-MB artifacts.
 */
export function MarkdownViewer({
  studyId,
  artifact,
  content,
  height = "100%",
  showOutline = true,
  emptyMessage = "Artifact not generated yet."
}: MarkdownViewerProps): JSX.Element {
  const [text, setText] = useState<string | null>(content ?? null);
  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [pendingSize, setPendingSize] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [matchCursor, setMatchCursor] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (content !== undefined) {
      setText(content);
    }
  }, [content]);

  useEffect(() => {
    if (content !== undefined || !studyId.trim()) {
      return;
    }
    let cancelled = false;
    setText(null);
    setError("");
    setNotFound(false);
    setPendingSize(null);
    setIsLoading(true);
    (async () => {
      try {
        const meta = await fetchArtifactMeta(studyId.trim(), artifact);
        if (cancelled) {
          return;
        }
        if (meta.size > SIZE_WARN_BYTES) {
          setPendingSize(meta.size);
          setIsLoading(false);
          return;
        }
        const loaded = await fetchArtifactText(studyId.trim(), artifact);
        if (!cancelled) {
          setText(loaded);
        }
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        if (loadError instanceof ArtifactNotFoundError) {
          setNotFound(true);
        } else {
          setError(loadError instanceof Error ? loadError.message : "Unable to load markdown.");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [studyId, artifact, content]);

  async function loadAnyway(): Promise<void> {
    setIsLoading(true);
    setPendingSize(null);
    try {
      const loaded = await fetchArtifactText(studyId.trim(), artifact);
      setText(loaded);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load markdown.");
    } finally {
      setIsLoading(false);
    }
  }

  const chunks = useMemo(() => (text === null ? [] : chunkMarkdown(text)), [text]);

  const outline = useMemo(
    () =>
      chunks
        .filter((chunk) => chunk.heading)
        .map((chunk) => ({ chunkId: chunk.id, ...chunk.heading! })),
    [chunks]
  );

  const matches = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) {
      return [];
    }
    return chunks.filter((chunk) => chunk.text.toLowerCase().includes(trimmed)).map((chunk) => chunk.id);
  }, [chunks, query]);

  const virtualizer = useVirtualizer({
    count: chunks.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 320,
    overscan: 4
  });

  useEffect(() => {
    setMatchCursor(0);
  }, [query]);

  function jumpToMatch(direction: 1 | -1): void {
    if (matches.length === 0) {
      return;
    }
    const next = (matchCursor + direction + matches.length) % matches.length;
    setMatchCursor(next);
    virtualizer.scrollToIndex(matches[next], { align: "start" });
  }

  if (error) {
    return <p className="step1-error">{error}</p>;
  }
  if (notFound) {
    return <p className="step7-muted">{emptyMessage}</p>;
  }
  if (pendingSize !== null) {
    return (
      <div className="markdown-viewer-gate">
        <p className="step7-muted">
          This markdown artifact is large ({formatByteSize(pendingSize)}). Rendering may take a moment.
        </p>
        <button type="button" className="button button-secondary" onClick={() => void loadAnyway()}>
          Load {formatByteSize(pendingSize)} anyway
        </button>
      </div>
    );
  }
  if (isLoading || text === null) {
    return <p className="step1-status">Loading markdown…</p>;
  }
  if (!text.trim()) {
    return <p className="step7-muted">{emptyMessage}</p>;
  }

  return (
    <div className="markdown-viewer" style={{ height }}>
      <div className="markdown-viewer-toolbar">
        <input
          className="input markdown-viewer-search"
          type="search"
          placeholder="Find in document…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              jumpToMatch(event.shiftKey ? -1 : 1);
            }
          }}
          aria-label="Find in document"
        />
        {query.trim() ? (
          <span className="markdown-viewer-matches">
            <button type="button" className="button button-ghost" onClick={() => jumpToMatch(-1)} disabled={matches.length === 0}>
              ↑
            </button>
            <button type="button" className="button button-ghost" onClick={() => jumpToMatch(1)} disabled={matches.length === 0}>
              ↓
            </button>
            <span className="step7-muted">
              {matches.length > 0 ? `${matchCursor + 1} / ${matches.length} sections` : "No matches"}
            </span>
          </span>
        ) : (
          <span className="step7-muted">{formatByteSize(text.length)}</span>
        )}
      </div>
      <div className="markdown-viewer-body">
        {showOutline && outline.length > 1 ? (
          <nav className="markdown-viewer-outline" aria-label="Document outline">
            {outline.map((entry) => (
              <button
                key={entry.chunkId}
                type="button"
                className="markdown-outline-item"
                style={{ paddingLeft: `${(entry.level - 1) * 12 + 8}px` }}
                onClick={() => virtualizer.scrollToIndex(entry.chunkId, { align: "start" })}
              >
                {entry.title || "(untitled)"}
              </button>
            ))}
          </nav>
        ) : null}
        <div className="markdown-viewer-scroll" ref={scrollRef}>
          <div className="markdown-viewer-inner" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const chunk = chunks[item.index];
              return (
                <div
                  key={chunk.id}
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  className="markdown-viewer-chunk markdown-preview"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{chunk.text}</ReactMarkdown>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

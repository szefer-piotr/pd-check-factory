import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArtifactNotFoundError,
  fetchArtifactJson,
  formatByteSize,
  type ArtifactKey
} from "../../services/artifactApi";
import { JsonTree } from "./JsonTree";

interface JsonViewerProps {
  /** Inline data; when omitted, loads studyId+artifact from the artifact endpoint. */
  data?: unknown;
  studyId?: string;
  artifact?: ArtifactKey;
  /** Schema-aware rendered view. When omitted, only the Raw tab is shown. */
  renderRendered?: (data: unknown) => ReactNode;
  renderedLabel?: string;
  emptyMessage?: string;
}

type JsonViewerTab = "rendered" | "raw";

/**
 * Two-tab JSON artifact viewer: Rendered (schema-aware) and Raw (collapsible tree + copy).
 */
export function JsonViewer({
  data,
  studyId,
  artifact,
  renderRendered,
  renderedLabel = "Rendered",
  emptyMessage = "Artifact not generated yet."
}: JsonViewerProps): JSX.Element {
  const [loaded, setLoaded] = useState<unknown>(data);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [tab, setTab] = useState<JsonViewerTab>(renderRendered ? "rendered" : "raw");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setLoaded(data);
  }, [data]);

  useEffect(() => {
    if (data !== undefined || !studyId || !artifact) {
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setError("");
    setNotFound(false);
    fetchArtifactJson<unknown>(studyId, artifact)
      .then((value) => {
        if (!cancelled) {
          setLoaded(value);
        }
      })
      .catch((loadError) => {
        if (cancelled) {
          return;
        }
        if (loadError instanceof ArtifactNotFoundError) {
          setNotFound(true);
        } else {
          setError(loadError instanceof Error ? loadError.message : "Unable to load artifact.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [data, studyId, artifact]);

  const rawText = useMemo(
    () => (loaded === undefined ? "" : JSON.stringify(loaded, null, 2)),
    [loaded]
  );

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(rawText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable
    }
  }

  if (isLoading) {
    return <p className="step1-status">Loading JSON artifact…</p>;
  }
  if (notFound) {
    return <p className="step7-muted">{emptyMessage}</p>;
  }
  if (error) {
    return <p className="step1-error">{error}</p>;
  }
  if (loaded === undefined) {
    return <p className="step7-muted">{emptyMessage}</p>;
  }

  return (
    <div className="json-viewer">
      <div className="json-viewer-toolbar">
        {renderRendered ? (
          <div className="viewer-tab-row" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "rendered"}
              className={`viewer-tab ${tab === "rendered" ? "viewer-tab-active" : ""}`}
              onClick={() => setTab("rendered")}
            >
              {renderedLabel}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "raw"}
              className={`viewer-tab ${tab === "raw" ? "viewer-tab-active" : ""}`}
              onClick={() => setTab("raw")}
            >
              Raw JSON
            </button>
          </div>
        ) : (
          <span className="step7-muted">Raw JSON ({formatByteSize(rawText.length)})</span>
        )}
        <button type="button" className="button button-ghost json-viewer-copy" onClick={() => void handleCopy()}>
          {copied ? "Copied ✓" : "Copy JSON"}
        </button>
      </div>
      {renderRendered && tab === "rendered" ? (
        <div className="json-viewer-rendered">{renderRendered(loaded)}</div>
      ) : (
        <div className="json-viewer-raw">
          <JsonTree data={loaded} />
        </div>
      )}
    </div>
  );
}

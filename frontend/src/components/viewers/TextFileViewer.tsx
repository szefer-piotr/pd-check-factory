import { useEffect, useState } from "react";
import {
  ArtifactNotFoundError,
  fetchArtifactText,
  formatByteSize,
  type ArtifactKey
} from "../../services/artifactApi";

interface TextFileViewerProps {
  studyId: string;
  artifact: ArtifactKey;
  emptyMessage?: string;
}

/** Full plain-text artifact viewer (monospace) — e.g. rules_raw.txt, deviations_raw.txt. */
export function TextFileViewer({
  studyId,
  artifact,
  emptyMessage = "Artifact not generated yet."
}: TextFileViewerProps): JSX.Element {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setText(null);
    setError("");
    setNotFound(false);
    if (!studyId.trim()) {
      return;
    }
    fetchArtifactText(studyId.trim(), artifact)
      .then((loaded) => {
        if (!cancelled) {
          setText(loaded);
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
      });
    return () => {
      cancelled = true;
    };
  }, [studyId, artifact]);

  if (error) {
    return <p className="step1-error">{error}</p>;
  }
  if (notFound) {
    return <p className="step7-muted">{emptyMessage}</p>;
  }
  if (text === null) {
    return <p className="step1-status">Loading…</p>;
  }
  return (
    <div className="text-file-viewer">
      <p className="step7-muted text-file-viewer-meta">{formatByteSize(text.length)}</p>
      <pre className="text-file-viewer-pre">{text}</pre>
    </div>
  );
}

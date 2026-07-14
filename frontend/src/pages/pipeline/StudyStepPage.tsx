import { useEffect, useRef, useState } from "react";
import { LogPanel } from "../../components/pipeline/LogPanel";
import { Card } from "../../components/layout/Card";
import { Stack } from "../../components/layout/Stack";
import {
  createStudy,
  deleteAllStudies,
  fetchStudies,
  loadStudy,
  type LoadStudyResponse,
  type PipelineLogLine,
  type StudyListItem
} from "../../services/stepApi";

function logLine(text: string, level: PipelineLogLine["level"] = "info"): PipelineLogLine {
  return { ts: new Date().toISOString(), level, text };
}

function formatSyncReport(id: string, sync: LoadStudyResponse["sync"]): string {
  const parts: string[] = [];
  if (sync.downloaded > 0) {
    parts.push(`${sync.downloaded} artifact${sync.downloaded === 1 ? "" : "s"} downloaded`);
  }
  if (sync.uploaded > 0) {
    parts.push(`${sync.uploaded} artifact${sync.uploaded === 1 ? "" : "s"} uploaded`);
  }
  if (sync.skipped > 0) {
    parts.push(`${sync.skipped} skipped`);
  }
  if (sync.errors > 0) {
    parts.push(`${sync.errors} error${sync.errors === 1 ? "" : "s"}`);
  }
  if (parts.length === 0) {
    return `Selected study ${id} (already up to date locally).`;
  }
  return `Loaded study ${id}: ${parts.join(", ")}.`;
}

interface StudyStepPageProps {
  studyId: string;
  onStudyIdChange: (value: string) => void;
  onCreated: () => void;
}

export function StudyStepPage({ studyId, onStudyIdChange, onCreated }: StudyStepPageProps): JSX.Element {
  const [studies, setStudies] = useState<StudyListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingStudyId, setLoadingStudyId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isWiping, setIsWiping] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [newStudyId, setNewStudyId] = useState(studyId);
  const [loadLogs, setLoadLogs] = useState<PipelineLogLine[]>([]);
  const [loadElapsedSec, setLoadElapsedSec] = useState(0);
  const loadTimerRef = useRef<number | null>(null);
  const loadTickRef = useRef(0);

  useEffect(() => {
    setNewStudyId(studyId);
  }, [studyId]);

  useEffect(() => {
    return () => {
      if (loadTimerRef.current !== null) {
        window.clearInterval(loadTimerRef.current);
      }
    };
  }, []);

  async function refreshStudyList(): Promise<void> {
    const result = await fetchStudies();
    setStudies(result.studies);
  }

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      setLoading(true);
      setError("");
      try {
        const result = await fetchStudies();
        if (!cancelled) {
          setStudies(result.studies);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load studies.");
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
  }, []);

  async function handleCreate(): Promise<void> {
    const trimmed = newStudyId.trim();
    if (!trimmed) {
      setError("Enter a study ID.");
      return;
    }
    setError("");
    setMessage("");

    const existsInList = studies.some((study) => study.studyId === trimmed);
    let overwrite = false;
    if (existsInList) {
      if (
        !window.confirm(
          `Study "${trimmed}" already exists. Overwrite it? This permanently deletes all blob and local artifacts for this study and starts fresh.`
        )
      ) {
        return;
      }
      overwrite = true;
    }

    setIsCreating(true);
    try {
      const result = await createStudy(trimmed, { overwrite });
      onStudyIdChange(trimmed);
      setMessage(
        result.overwritten
          ? `Overwrote study ${trimmed} (${result.deletedBlobCount ?? 0} blob object${result.deletedBlobCount === 1 ? "" : "s"} removed).`
          : `Created study ${trimmed}.`
      );
      await refreshStudyList();
      onCreated();
    } catch (createError) {
      const createMessage = createError instanceof Error ? createError.message : "Unable to create study.";
      if (!overwrite && createMessage.toLowerCase().includes("already exists")) {
        if (
          window.confirm(
            `Study "${trimmed}" already exists. Overwrite it? This permanently deletes all blob and local artifacts for this study and starts fresh.`
          )
        ) {
          setIsCreating(true);
          try {
            const result = await createStudy(trimmed, { overwrite: true });
            onStudyIdChange(trimmed);
            setMessage(
              `Overwrote study ${trimmed} (${result.deletedBlobCount ?? 0} blob object${result.deletedBlobCount === 1 ? "" : "s"} removed).`
            );
            await refreshStudyList();
            onCreated();
          } catch (overwriteError) {
            setError(overwriteError instanceof Error ? overwriteError.message : "Unable to overwrite study.");
          } finally {
            setIsCreating(false);
          }
          return;
        }
      }
      setError(createMessage);
    } finally {
      setIsCreating(false);
    }
  }

  async function handleWipeBlob(): Promise<void> {
    if (loadingStudyId || isWiping) {
      return;
    }
    if (
      !window.confirm(
        "Delete all studies from blob storage? This permanently removes every study under raw/, extractions/, pipeline/, and review/, plus matching local output folders. This cannot be undone."
      )
    ) {
      return;
    }
    setIsWiping(true);
    setError("");
    setMessage("");
    try {
      const result = await deleteAllStudies();
      setStudies([]);
      onStudyIdChange("");
      setNewStudyId("");
      setMessage(
        result.message ||
          `Deleted ${result.deletedStudyCount} study/studies (${result.deletedBlobCount} blob object(s)).`
      );
    } catch (wipeError) {
      setError(wipeError instanceof Error ? wipeError.message : "Unable to wipe blob storage.");
    } finally {
      setIsWiping(false);
    }
  }

  function stopLoadTimer(): void {
    if (loadTimerRef.current !== null) {
      window.clearInterval(loadTimerRef.current);
      loadTimerRef.current = null;
    }
  }

  function appendLoadLog(text: string, level: PipelineLogLine["level"] = "info"): void {
    setLoadLogs((previous) => [...previous, logLine(text, level)]);
  }

  async function handleSelect(id: string): Promise<void> {
    if (loadingStudyId) {
      return;
    }
    setLoadingStudyId(id);
    setError("");
    setMessage("");
    setLoadElapsedSec(0);
    loadTickRef.current = 0;
    setLoadLogs([
      logLine(`Selected study ${id}.`),
      logLine("Syncing with blob storage — downloading pipeline artifacts and checkpoints…")
    ]);
    stopLoadTimer();
    loadTimerRef.current = window.setInterval(() => {
      setLoadElapsedSec((previous) => previous + 1);
      loadTickRef.current += 1;
      if (loadTickRef.current % 5 === 0) {
        appendLoadLog("Still syncing with blob storage…");
      }
    }, 1000);
    try {
      const result = await loadStudy(id);
      onStudyIdChange(id);
      setNewStudyId(id);
      const summary = formatSyncReport(id, result.sync);
      setMessage(summary);
      appendLoadLog(summary);
      if (result.sync.errors > 0) {
        for (const syncError of result.sync.errorMessages.slice(0, 5)) {
          appendLoadLog(syncError, "error");
        }
        if (result.sync.errorMessages.length > 5) {
          appendLoadLog(
            `${result.sync.errorMessages.length - 5} additional sync error(s) omitted.`,
            "warn"
          );
        }
      }
    } catch (selectError) {
      const selectMessage =
        selectError instanceof Error ? selectError.message : "Unable to load study from blob.";
      setError(selectMessage);
      appendLoadLog(selectMessage, "error");
    } finally {
      stopLoadTimer();
      setLoadingStudyId(null);
    }
  }

  return (
    <Stack gap="md">
      <div className="pipeline-step-page">
      <header className="pipeline-step-header">
        <div>
          <h1>Study</h1>
          <p className="pipeline-step-description">
            Create a new study or select an existing folder from blob storage. Selecting a study downloads
            pipeline artifacts and checkpoints.
          </p>
        </div>
      </header>

      {error ? <p className="pipeline-error">{error}</p> : null}
      {message ? <p className="pipeline-message">{message}</p> : null}

      {loadingStudyId ? (
        <div className="upload-card-progress pipeline-study-sync-banner" role="status" aria-live="polite">
          <span className="upload-spinner" aria-hidden="true" />
          <div className="upload-card-progress-text">
            <span>
              Syncing <strong>{loadingStudyId}</strong> with blob storage…
            </span>
            <span className="pipeline-hint">
              {loadElapsedSec > 0 ? `${loadElapsedSec}s elapsed — ` : ""}
              Downloading artifacts and checkpoints. Large studies may take several minutes.
            </span>
          </div>
        </div>
      ) : null}

      {loadLogs.length > 0 ? <LogPanel logs={loadLogs} active={loadingStudyId !== null} /> : null}

      <Card>
        <Stack gap="sm">
          <label className="pipeline-field">
            <span>Study ID</span>
            <input
              value={newStudyId}
              onChange={(event) => setNewStudyId(event.target.value)}
              placeholder="e.g. TARA-002-201"
            />
          </label>
          <button type="button" onClick={() => void handleCreate()} disabled={Boolean(loadingStudyId) || isCreating}>
            {isCreating ? "Creating…" : "Create study"}
          </button>
        </Stack>
      </Card>

      <Card>
        <div className="pipeline-step-header">
          <h2>Existing studies</h2>
          <div className="pipeline-step-actions">
            <button
              type="button"
              className="secondary"
              disabled={loading || loadingStudyId !== null || isWiping}
              onClick={() => {
                setLoading(true);
                setError("");
                void refreshStudyList()
                  .catch((refreshError) => {
                    setError(refreshError instanceof Error ? refreshError.message : "Unable to load studies.");
                  })
                  .finally(() => setLoading(false));
              }}
            >
              Refresh
            </button>
            <button
              type="button"
              className="button button-danger"
              disabled={loading || loadingStudyId !== null || isWiping}
              onClick={() => void handleWipeBlob()}
            >
              {isWiping ? "Wiping…" : "Wipe blob storage"}
            </button>
          </div>
        </div>
        {loading ? <p>Loading study folders from blob…</p> : null}
        {!loading && studies.length === 0 ? (
          <p>No studies found in blob storage.</p>
        ) : null}
        <ul className="pipeline-study-list">
          {studies.map((study) => (
            <li key={study.studyId}>
              <button
                type="button"
                className={study.studyId === studyId.trim() ? "selected" : ""}
                onClick={() => void handleSelect(study.studyId)}
                disabled={loadingStudyId !== null}
              >
                <strong>{study.studyId}</strong>
                <span>
                  {loadingStudyId === study.studyId
                    ? `Syncing…${loadElapsedSec > 0 ? ` (${loadElapsedSec}s)` : ""}`
                    : study.stage}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Card>
      </div>
    </Stack>
  );
}

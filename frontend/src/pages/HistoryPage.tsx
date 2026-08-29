import { useEffect, useMemo, useState } from "react";
import { Panel } from "../components/layout/Panel";
import { navigateToPipelineStep } from "../pipeline/pipelineRoute";
import { fetchStudies, loadStudy, type StudyListItem } from "../services/stepApi";

function formatModified(value?: string | null): string {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

export function HistoryPage(): JSX.Element {
  const [studies, setStudies] = useState<StudyListItem[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openingId, setOpeningId] = useState<string | null>(null);

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
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load studies.");
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

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) {
      return studies;
    }
    return studies.filter(
      (study) =>
        study.studyId.toLowerCase().includes(q) ||
        (study.workflowLabel || "").toLowerCase().includes(q) ||
        (study.stage || "").toLowerCase().includes(q)
    );
  }, [filter, studies]);

  async function openStudy(studyId: string): Promise<void> {
    setOpeningId(studyId);
    setError("");
    try {
      await loadStudy(studyId);
      navigateToPipelineStep("study-setup", { section: "study", studyId });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open study.");
    } finally {
      setOpeningId(null);
    }
  }

  return (
    <div className="history-page">
      <header className="page-hero">
        <h1>History</h1>
        <p>Open a previous study or start a new one in the pipeline.</p>
        <button
          type="button"
          className="button button-primary"
          onClick={() => navigateToPipelineStep("study-setup", { section: "study" })}
        >
          Start study
        </button>
      </header>

      <Panel
        title="Studies"
        subtitle={loading ? "Loading…" : `${filtered.length} study${filtered.length === 1 ? "" : "ies"}`}
        actions={
          <input
            className="input history-filter"
            type="search"
            placeholder="Filter studies"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            aria-label="Filter studies"
          />
        }
      >
        {error ? <p className="pipeline-error">{error}</p> : null}
        {!loading && filtered.length === 0 ? (
          <p className="muted">No studies yet. Create one from Start study.</p>
        ) : (
          <div className="history-study-list">
            {filtered.map((study) => (
              <button
                key={study.studyId}
                type="button"
                className="history-study-card"
                disabled={openingId === study.studyId}
                onClick={() => void openStudy(study.studyId)}
              >
                <div className="history-study-main">
                  <strong>{study.studyId}</strong>
                  <span className="muted">{formatModified(study.lastModified)}</span>
                </div>
                <span className="chip">{study.stage || study.workflowLabel || "Study"}</span>
              </button>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

import type { StudyListItem } from "../../services/stepApi";

interface ProjectLibraryPageProps {
  studies: StudyListItem[];
  isLoading: boolean;
  error: string;
  onSelect: (studyId: string) => void;
  onReload: () => void;
}

const STAGE_LABELS: Record<string, string> = {
  project: "Project",
  setup: "Setup",
  summary: "Summary",
  processing: "Processing",
  review: "Review"
};

export function ProjectLibraryPage({
  studies,
  isLoading,
  error,
  onSelect,
  onReload
}: ProjectLibraryPageProps): JSX.Element {
  return (
    <section className="wizard-library" aria-label="Project library">
      <header className="wizard-page-header">
        <h2>Project Library</h2>
        <button className="button button-secondary" type="button" onClick={onReload} disabled={isLoading}>
          {isLoading ? "Loading…" : "Reload"}
        </button>
      </header>
      {error ? <p className="step1-error">{error}</p> : null}
      {isLoading && studies.length === 0 ? <p className="step7-muted">Loading studies…</p> : null}
      {!isLoading && studies.length === 0 ? (
        <p className="step7-muted">No studies found. Create a new project to get started.</p>
      ) : (
        <div className="wizard-library-table-wrap">
          <table className="wizard-library-table">
            <thead>
              <tr>
                <th>Study ID</th>
                <th>Workflow</th>
                <th>Stage</th>
                <th>Last modified</th>
              </tr>
            </thead>
            <tbody>
              {studies.map((study) => (
                <tr key={study.studyId}>
                  <td>
                    <button className="button button-ghost wizard-library-select" type="button" onClick={() => onSelect(study.studyId)}>
                      {study.studyId}
                    </button>
                  </td>
                  <td>{study.workflowLabel || "—"}</td>
                  <td>{STAGE_LABELS[study.stage] ?? study.stage}</td>
                  <td>{study.lastModified ? new Date(study.lastModified).toLocaleString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

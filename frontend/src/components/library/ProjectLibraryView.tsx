import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchStudies, type LibraryStudyOption } from "../../services/stepApi";
import { stagePath, workflowLabel } from "../../types/workflow";

interface ProjectLibraryViewProps {
  onBack: () => void;
}

function formatDate(value: string | null): string {
  if (!value) {
    return "—";
  }
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
      new Date(value)
    );
  } catch {
    return value;
  }
}

export function ProjectLibraryView({ onBack }: ProjectLibraryViewProps): JSX.Element {
  const navigate = useNavigate();
  const [studies, setStudies] = useState<LibraryStudyOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load(): Promise<void> {
      setIsLoading(true);
      setError("");
      try {
        const response = await fetchStudies();
        setStudies(response.studies);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load project library.");
      } finally {
        setIsLoading(false);
      }
    }
    void load();
  }, []);

  return (
    <div className="project-library">
      <header className="project-library-header">
        <button className="button button-secondary button-small" type="button" onClick={onBack}>
          Back
        </button>
        <h2 className="project-library-title">Project Library</h2>
      </header>
      {isLoading ? <p className="step7-muted">Loading projects…</p> : null}
      {error ? <p className="step1-error">{error}</p> : null}
      {!isLoading && studies.length === 0 ? (
        <p className="step7-muted">No projects found. Create a new project to get started.</p>
      ) : null}
      {studies.length > 0 ? (
        <table className="project-library-table">
          <thead>
            <tr>
              <th scope="col">Study ID</th>
              <th scope="col">Workflow</th>
              <th scope="col">Stage</th>
              <th scope="col">Last modified</th>
            </tr>
          </thead>
          <tbody>
            {studies.map((study) => (
              <tr key={study.studyId}>
                <td>
                  <button
                    className="project-library-link"
                    type="button"
                    onClick={() => navigate(stagePath(study.studyId, study.stage))}
                  >
                    {study.studyId}
                  </button>
                </td>
                <td>{workflowLabel(study.workflow)}</td>
                <td>{study.stage}</td>
                <td>{formatDate(study.lastModified)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

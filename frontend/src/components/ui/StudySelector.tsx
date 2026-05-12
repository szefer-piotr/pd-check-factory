import type { StudyOption } from "../../services/stepApi";

interface StudySelectorProps {
  value: string;
  onChange: (next: string) => void;
  studies: StudyOption[];
  isLoading?: boolean;
  error?: string;
  onReload?: () => void;
}

export function StudySelector({ value, onChange, studies, isLoading = false, error = "", onReload }: StudySelectorProps): JSX.Element {
  const hasStudies = studies.length > 0;

  return (
    <label className="control-group" htmlFor={hasStudies ? "study-id-select" : "study-id-input"}>
      <span className="control-label">Study ID</span>
      {hasStudies ? (
        <select id="study-id-select" className="select" value={value} onChange={(event) => onChange(event.target.value)}>
          {studies.map((study) => (
            <option key={study.studyId} value={study.studyId}>
              {study.studyId}
            </option>
          ))}
        </select>
      ) : (
        <input
          id="study-id-input"
          className="input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="MY-STUDY"
          autoComplete="off"
        />
      )}
      <span className="step7-muted">
        {isLoading ? "Loading projects from blob..." : error || (hasStudies ? `${studies.length} blob project${studies.length === 1 ? "" : "s"} available` : "Manual entry")}
      </span>
      {onReload ? (
        <button className="button button-secondary" type="button" onClick={onReload} disabled={isLoading}>
          Reload projects
        </button>
      ) : null}
    </label>
  );
}

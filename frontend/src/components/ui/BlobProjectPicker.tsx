import type { StudyOption } from "../../services/stepApi";

interface BlobProjectPickerProps {
  id?: string;
  value: string;
  studies: StudyOption[];
  isLoading?: boolean;
  error?: string;
  onChange: (studyId: string) => void;
  onReload?: () => void;
}

function formatStudyLabel(study: StudyOption): string {
  if (study.bothUploaded) {
    return study.studyId;
  }
  const parts: string[] = [];
  if (study.protocolFileName) {
    parts.push("protocol");
  }
  if (study.acrfFileName) {
    parts.push("aCRF");
  }
  if (parts.length === 0) {
    return `${study.studyId} (artifacts only)`;
  }
  return `${study.studyId} (${parts.join(" + ")} only)`;
}

export function BlobProjectPicker({
  id = "blob-project-picker",
  value,
  studies,
  isLoading = false,
  error = "",
  onChange,
  onReload
}: BlobProjectPickerProps): JSX.Element {
  const trimmedValue = value.trim();
  const knownIds = new Set(studies.map((study) => study.studyId));
  const isNewProject = Boolean(trimmedValue) && !knownIds.has(trimmedValue);
  const selectedValue = trimmedValue && (knownIds.has(trimmedValue) || isNewProject) ? trimmedValue : "";

  const placeholder = isLoading
    ? "Loading studies…"
    : error
      ? "Unable to load studies"
      : studies.length === 0 && !isNewProject
        ? "No studies found — create one"
        : "Select a study…";

  return (
    <div className="blob-project-picker">
      <label className="control-group" htmlFor={id}>
        <span className="control-label">Study</span>
        <div className="blob-project-picker-row">
          <select
            id={id}
            className="select blob-project-picker-select"
            value={selectedValue}
            onChange={(event) => {
              if (event.target.value) {
                onChange(event.target.value);
              }
            }}
            disabled={isLoading || (studies.length === 0 && !isNewProject)}
          >
            <option value="">{placeholder}</option>
            {isNewProject ? (
              <option value={trimmedValue}>{`${trimmedValue} (new project)`}</option>
            ) : null}
            {studies.map((study) => (
              <option key={study.studyId} value={study.studyId}>
                {formatStudyLabel(study)}
              </option>
            ))}
          </select>
          {onReload ? (
            <button className="button button-secondary" type="button" onClick={onReload} disabled={isLoading}>
              Reload
            </button>
          ) : null}
        </div>
        <span className="step7-muted">
          {error ||
            (isLoading
              ? "Scanning blob storage for studies…"
              : studies.length > 0
                ? `${studies.length} stud${studies.length === 1 ? "y" : "ies"} available`
                : isNewProject
                  ? "New project — upload documents to register in blob storage"
                  : "No studies in blob yet — create one to start")}
        </span>
      </label>
    </div>
  );
}

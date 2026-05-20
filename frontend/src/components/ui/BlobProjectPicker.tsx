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
  const knownIds = new Set(studies.map((study) => study.studyId));
  const selectedValue = knownIds.has(value.trim()) ? value.trim() : "";

  const placeholder = isLoading
    ? "Loading projects from blob…"
    : error
      ? "Unable to load projects"
      : studies.length === 0
        ? "No projects found in blob storage"
        : "Select existing project…";

  return (
    <div className="blob-project-picker">
      <label className="control-group" htmlFor={id}>
        <span className="control-label">Blob projects</span>
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
            disabled={isLoading || studies.length === 0}
          >
            <option value="">{placeholder}</option>
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
              ? "Scanning blob storage for projects…"
              : studies.length > 0
                ? `${studies.length} project${studies.length === 1 ? "" : "s"} in blob — pick one or type a new ID below`
                : "No projects in blob yet — type a new study ID below to start")}
        </span>
      </label>
    </div>
  );
}

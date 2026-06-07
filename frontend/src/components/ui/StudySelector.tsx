import type { StudyOption } from "../../services/stepApi";
import { BlobProjectPicker } from "./BlobProjectPicker";

interface StudySelectorProps {
  value: string;
  onChange: (next: string) => void;
  onNewStudy?: () => void;
  onDeleteStudy?: () => void;
  studies: StudyOption[];
  isLoading?: boolean;
  isDeleting?: boolean;
  error?: string;
  onReload?: () => void;
  blobPickerId?: string;
}

export function StudySelector({
  value,
  onChange,
  onNewStudy,
  onDeleteStudy,
  studies,
  isLoading = false,
  isDeleting = false,
  error = "",
  onReload,
  blobPickerId
}: StudySelectorProps): JSX.Element {
  const normalizedValue = value.trim();

  return (
    <div className="study-selector">
      <div className="study-selector-row">
        <BlobProjectPicker
          id={blobPickerId}
          value={value}
          studies={studies}
          isLoading={isLoading}
          error={error}
          onChange={onChange}
          onReload={onReload}
        />
        {onNewStudy ? (
          <button className="button button-primary study-selector-action" type="button" onClick={onNewStudy} disabled={isLoading || isDeleting}>
            New study
          </button>
        ) : null}
        {onDeleteStudy ? (
          <button
            className="button button-danger study-selector-action"
            type="button"
            onClick={onDeleteStudy}
            disabled={isLoading || isDeleting || !normalizedValue}
            title={normalizedValue ? `Delete all blob data for ${normalizedValue}` : "Select a study to delete"}
          >
            {isDeleting ? "Deleting…" : "Delete study"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

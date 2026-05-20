import { useEffect, useId, useState } from "react";
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
  /** When true, show the blob project dropdown first (for Step 1). */
  showBlobPickerFirst?: boolean;
  blobPickerId?: string;
}

function normalizeStudyId(raw: string): string {
  return raw.trim();
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
  showBlobPickerFirst = false,
  blobPickerId
}: StudySelectorProps): JSX.Element {
  const datalistId = useId();
  const generatedPickerId = useId();
  const quickPickId = blobPickerId ?? generatedPickerId;
  const [draftId, setDraftId] = useState(value);
  const normalizedValue = normalizeStudyId(value);
  const normalizedDraft = normalizeStudyId(draftId);
  const isDraftDirty = normalizedDraft !== normalizedValue;
  const knownIds = new Set(studies.map((study) => study.studyId));
  const isCustomProject = Boolean(normalizedValue) && !knownIds.has(normalizedValue);

  useEffect(() => {
    setDraftId(value);
  }, [value]);

  function commitDraft(): void {
    if (!normalizedDraft) {
      return;
    }
    onChange(normalizedDraft);
  }

  function handleQuickPick(nextStudyId: string): void {
    setDraftId(nextStudyId);
    onChange(nextStudyId);
  }

  const blobPicker = (
    <BlobProjectPicker
      id={quickPickId}
      value={value}
      studies={studies}
      isLoading={isLoading}
      error={error}
      onChange={handleQuickPick}
      onReload={onReload}
    />
  );

  return (
    <div className={`study-selector ${showBlobPickerFirst ? "study-selector-step1" : ""}`}>
      {showBlobPickerFirst ? blobPicker : null}
      <label className="control-group" htmlFor="study-id-input">
        {showBlobPickerFirst ? <span className="control-label">Or enter a new study ID</span> : <span className="control-label">Study ID</span>}
        <div className="study-selector-row">
          <input
            id="study-id-input"
            className="input study-selector-input"
            value={draftId}
            onChange={(event) => setDraftId(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitDraft();
              }
            }}
            placeholder="Type a new project ID"
            autoComplete="off"
            list={studies.length > 0 ? datalistId : undefined}
            disabled={isLoading}
          />
          {studies.length > 0 ? (
            <datalist id={datalistId}>
              {studies.map((study) => (
                <option key={study.studyId} value={study.studyId} />
              ))}
            </datalist>
          ) : null}
          <button
            className="button button-secondary"
            type="button"
            onClick={commitDraft}
            disabled={isLoading || !isDraftDirty || !normalizedDraft}
          >
            Use ID
          </button>
          {onNewStudy ? (
            <button className="button button-primary" type="button" onClick={onNewStudy} disabled={isLoading || isDeleting}>
              New study
            </button>
          ) : null}
          {onDeleteStudy ? (
            <button
              className="button button-danger"
              type="button"
              onClick={onDeleteStudy}
              disabled={isLoading || isDeleting || !normalizedValue}
              title={normalizedValue ? `Delete all blob data for ${normalizedValue}` : "Enter a study ID to delete"}
            >
              {isDeleting ? "Deleting…" : "Delete study"}
            </button>
          ) : null}
        </div>
        {!showBlobPickerFirst ? (
          <>
            {blobPicker}
            <span className="step7-muted">{isCustomProject ? "Custom project (not in blob list yet)" : ""}</span>
          </>
        ) : (
          <span className="step7-muted">{isCustomProject ? "Custom project (not in blob list yet)" : ""}</span>
        )}
      </label>
    </div>
  );
}

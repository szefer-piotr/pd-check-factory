import { useEffect, useId, useState } from "react";
import type { StudyOption } from "../../services/stepApi";

interface StudySelectorProps {
  value: string;
  onChange: (next: string) => void;
  studies: StudyOption[];
  isLoading?: boolean;
  error?: string;
  onReload?: () => void;
}

function normalizeStudyId(raw: string): string {
  return raw.trim();
}

export function StudySelector({ value, onChange, studies, isLoading = false, error = "", onReload }: StudySelectorProps): JSX.Element {
  const datalistId = useId();
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

  return (
    <div className="study-selector">
      <label className="control-group" htmlFor="study-id-input">
        <span className="control-label">Study ID</span>
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
            placeholder="Type a new project ID or pick below"
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
        </div>
        {studies.length > 0 ? (
          <label className="control-group study-selector-quick-pick" htmlFor="study-id-quick-pick">
            <span className="control-label">Blob projects</span>
            <select
              id="study-id-quick-pick"
              className="select"
              value={knownIds.has(normalizedValue) ? normalizedValue : ""}
              onChange={(event) => {
                if (event.target.value) {
                  handleQuickPick(event.target.value);
                }
              }}
              disabled={isLoading}
            >
              <option value="">Select existing project…</option>
              {studies.map((study) => (
                <option key={study.studyId} value={study.studyId}>
                  {study.studyId}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <span className="step7-muted">
          {isLoading
            ? "Loading projects from blob..."
            : error ||
              (studies.length > 0
                ? `${studies.length} blob project${studies.length === 1 ? "" : "s"} available — type a new ID and click Use ID`
                : "Type a project ID and click Use ID")}
          {isCustomProject ? " · Custom project (not in blob list yet)" : ""}
        </span>
        {onReload ? (
          <button className="button button-secondary" type="button" onClick={onReload} disabled={isLoading}>
            Reload projects
          </button>
        ) : null}
      </label>
    </div>
  );
}

import { useState } from "react";
import { WORKFLOW_TILES, type WorkflowChoice } from "../../data/wizardSteps";
import { createStudy } from "../../services/stepApi";

interface ProjectPageProps {
  studyId: string;
  selectedWorkflow: WorkflowChoice | null;
  isCreating: boolean;
  createMode: boolean;
  onStudyCreated: (studyId: string) => void;
  onWorkflowSelect: (workflow: WorkflowChoice) => void;
  onDeleteStudy?: () => void;
  isDeleting?: boolean;
  deleteError?: string;
}

function validateStudyId(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return "Study ID is required.";
  }
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    return "Study ID must not contain path separators.";
  }
  return null;
}

export function ProjectPage({
  studyId,
  selectedWorkflow,
  isCreating,
  createMode,
  onStudyCreated,
  onWorkflowSelect,
  onDeleteStudy,
  isDeleting = false,
  deleteError = ""
}: ProjectPageProps): JSX.Element {
  const [draftId, setDraftId] = useState("");
  const [localError, setLocalError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleCreate(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const validation = validateStudyId(draftId);
    if (validation) {
      setLocalError(validation);
      return;
    }
    setLocalError("");
    setSubmitting(true);
    try {
      await createStudy(draftId.trim());
      onStudyCreated(draftId.trim());
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Unable to create study.");
    } finally {
      setSubmitting(false);
    }
  }

  if (createMode && !studyId) {
    return (
      <section className="wizard-project" aria-label="New project">
        <h2>New Project</h2>
        <form className="wizard-create-form" onSubmit={(event) => void handleCreate(event)}>
          <label className="wizard-field">
            <span>Study ID</span>
            <input
              type="text"
              value={draftId}
              onChange={(event) => setDraftId(event.target.value)}
              placeholder="e.g. STUDY-2026-001"
              disabled={submitting || isCreating}
            />
          </label>
          {localError ? <p className="step1-error">{localError}</p> : null}
          <button className="button button-primary" type="submit" disabled={submitting || isCreating}>
            {submitting ? "Creating…" : "Create project"}
          </button>
        </form>
      </section>
    );
  }

  return (
    <section className="wizard-project" aria-label="Project">
      <header className="wizard-page-header">
        <h2>{studyId}</h2>
        {onDeleteStudy ? (
          <button className="button button-secondary" type="button" onClick={onDeleteStudy} disabled={isDeleting}>
            {isDeleting ? "Deleting…" : "Delete project"}
          </button>
        ) : null}
      </header>
      {deleteError ? <p className="step1-error">{deleteError}</p> : null}
      <p className="step7-muted">Choose how this study will produce PD specifications for review.</p>
      <div className="wizard-workflow-tiles">
        {WORKFLOW_TILES.map((tile) => (
          <article
            key={tile.choice}
            className={`wizard-workflow-tile ${selectedWorkflow === tile.choice ? "wizard-workflow-tile-selected" : ""}`}
          >
            <h3>{tile.title}</h3>
            <p className="step7-muted">{tile.description}</p>
            <button
              className="button button-primary"
              type="button"
              onClick={() => onWorkflowSelect(tile.choice)}
              aria-pressed={selectedWorkflow === tile.choice}
            >
              {selectedWorkflow === tile.choice ? "Selected" : "Select"}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

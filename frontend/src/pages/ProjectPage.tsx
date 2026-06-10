import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Section } from "../components/layout/Section";
import { useStudyContext } from "../hooks/useStudyContext";
import { setStudyWorkflow, type StudyWorkflow } from "../services/stepApi";
import { WORKFLOW_TILES } from "../types/workflow";

export function ProjectPage(): JSX.Element {
  const { studyId, refresh } = useStudyContext();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [pendingWorkflow, setPendingWorkflow] = useState<StudyWorkflow | null>(null);

  async function handleSelect(workflow: StudyWorkflow): Promise<void> {
    if (pendingWorkflow) {
      return;
    }
    setPendingWorkflow(workflow);
    setError("");
    try {
      const result = await setStudyWorkflow(studyId, workflow);
      await refresh();
      navigate(`/projects/${encodeURIComponent(studyId)}/setup`, {
        replace: result.uiStage === "setup"
      });
    } catch (selectError) {
      setError(selectError instanceof Error ? selectError.message : "Unable to save workflow choice.");
    } finally {
      setPendingWorkflow(null);
    }
  }

  return (
    <Section>
      <h2 className="page-title">Choose workflow</h2>
      <p className="page-lead">Select how this study will build its deviation review dataset.</p>
      {error ? <p className="step1-error">{error}</p> : null}
      <div className="welcome-tiles workflow-tiles">
        {WORKFLOW_TILES.map((tile) => (
          <button
            key={tile.id}
            className="welcome-tile"
            type="button"
            disabled={pendingWorkflow !== null}
            onClick={() => void handleSelect(tile.id)}
          >
            <span className="welcome-tile-title">{tile.title}</span>
            <span className="welcome-tile-desc">{tile.description}</span>
            {pendingWorkflow === tile.id ? (
              <span className="welcome-tile-status">Saving…</span>
            ) : null}
          </button>
        ))}
      </div>
    </Section>
  );
}

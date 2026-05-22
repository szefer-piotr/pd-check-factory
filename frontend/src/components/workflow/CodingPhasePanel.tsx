interface CodingPhasePanelProps {
  studyId: string;
}

export function CodingPhasePanel({ studyId }: CodingPhasePanelProps): JSX.Element {
  return (
    <section className="coding-phase" aria-label="Coding phase">
      <header className="coding-phase-header">
        <p className="coding-phase-eyebrow">Step 5</p>
        <h2 className="coding-phase-title">Coding phase</h2>
        <p className="coding-phase-subtitle">
          Implement programmable checks from reviewed PD specifications for{" "}
          <strong>{studyId.trim() || "this study"}</strong>.
        </p>
      </header>
      <div className="coding-phase-body">
        <div className="coding-phase-empty">
          <p className="coding-phase-empty-title">Coming soon</p>
          <p className="coding-phase-empty-text">
            The coding workspace will host check implementation, validation runs, and links to deviation context
            artifacts. This section is intentionally separate from the PD specification generation pipeline.
          </p>
        </div>
      </div>
    </section>
  );
}

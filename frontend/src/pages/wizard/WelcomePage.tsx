interface WelcomePageProps {
  onNewProject: () => void;
  onOpenLibrary: () => void;
}

export function WelcomePage({ onNewProject, onOpenLibrary }: WelcomePageProps): JSX.Element {
  return (
    <section className="wizard-welcome" aria-label="Welcome">
      <div className="wizard-welcome-brand">
        <img className="wizard-logo" src="/rho-logo-placeholder.svg" alt="Rho Inc." width={96} height={96} />
        <h1 className="wizard-product-title">Rho PD Assurance</h1>
        <p className="wizard-product-subtitle">Guided corporate workflow for protocol deviation assurance</p>
      </div>
      <div className="wizard-entry-tiles">
        <button className="wizard-entry-tile" type="button" onClick={onNewProject}>
          <span className="wizard-entry-tile-title">New Project</span>
          <span className="wizard-entry-tile-desc">Create a study and choose your PD workflow</span>
        </button>
        <button className="wizard-entry-tile" type="button" onClick={onOpenLibrary}>
          <span className="wizard-entry-tile-title">Select from Project Library</span>
          <span className="wizard-entry-tile-desc">Resume an existing study at the right stage</span>
        </button>
      </div>
    </section>
  );
}

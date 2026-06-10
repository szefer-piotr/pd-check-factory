import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import rhoLogo from "../assets/rho-logo.svg";
import { Page } from "../components/layout/Page";
import { Section } from "../components/layout/Section";
import { Stack } from "../components/layout/Stack";
import { ProjectLibraryView } from "../components/library/ProjectLibraryView";

export function WelcomePage(): JSX.Element {
  const navigate = useNavigate();
  const [showLibrary, setShowLibrary] = useState(false);

  useEffect(() => {
    document.title = "Rho PD Assurance";
  }, []);

  return (
    <Page>
      <Stack gap="lg">
        <Section className="welcome-hero">
          <img className="welcome-logo" src={rhoLogo} alt="Rho Inc." />
          <h1 className="welcome-title">Rho PD Assurance</h1>
          <p className="welcome-subtitle">
            Guided protocol deviation review for clinical data management teams.
          </p>
        </Section>

        {!showLibrary ? (
          <Section>
            <div className="welcome-tiles">
              <button
                className="welcome-tile"
                type="button"
                onClick={() => navigate("/projects/new")}
              >
                <span className="welcome-tile-title">New Project</span>
                <span className="welcome-tile-desc">Create a study workspace and choose a workflow.</span>
              </button>
              <button
                className="welcome-tile"
                type="button"
                onClick={() => setShowLibrary(true)}
              >
                <span className="welcome-tile-title">Select from Project Library</span>
                <span className="welcome-tile-desc">Resume an existing study at its current stage.</span>
              </button>
            </div>
          </Section>
        ) : (
          <Section>
            <ProjectLibraryView onBack={() => setShowLibrary(false)} />
          </Section>
        )}
      </Stack>
    </Page>
  );
}

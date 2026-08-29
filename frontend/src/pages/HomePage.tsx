import { useEffect, useState } from "react";
import { Panel } from "../components/layout/Panel";
import { RhoMark } from "../components/brand/RhoLogo";
import {
  ChatIcon,
  CostIcon,
  PipelineIcon,
  ReviewIcon,
  RulesIcon,
  UploadIcon
} from "../components/ui/Icons";
import { navigateToPipelineStep } from "../pipeline/pipelineRoute";
import { navigateToApp } from "../pipeline/appRoute";
import { fetchStudies, type StudyListItem } from "../services/stepApi";

const features = [
  {
    icon: <UploadIcon />,
    title: "Study setup",
    description: "Select a study, choose models, and preprocess protocol and aCRF PDFs.",
    color: "var(--brand-primary)"
  },
  {
    icon: <RulesIcon />,
    title: "Protocol rules",
    description: "Extract paragraph-anchored rules and refine them in a shared chat workspace.",
    color: "var(--brand-primary)"
  },
  {
    icon: <ReviewIcon />,
    title: "Deviation review",
    description: "Accept, reject, and refine protocol deviation candidates with per-row chat.",
    color: "var(--brand-accent-dark)"
  },
  {
    icon: <CostIcon />,
    title: "Cost analysis",
    description: "Estimate Azure OpenAI and Document Intelligence spend per study.",
    color: "var(--brand-primary)"
  },
  {
    icon: <ChatIcon />,
    title: "Chat refinement",
    description: "Discuss rules and deviations in context with grounded edits.",
    color: "var(--brand-accent-dark)"
  }
];

const gettingStarted = [
  ["Select or create a study", "Open Pipeline and choose an existing study or create a new one."],
  ["Configure models", "Pick Azure OpenAI deployments for extraction, aCRF summary, and chat."],
  ["Upload documents", "Add protocol and aCRF PDFs, then run preprocessing."],
  ["Extract rules", "Generate protocol rules with paragraph references."],
  ["Extract and review deviations", "Pull candidates, refine them in chat, and accept the set."],
  ["Export and check cost", "Download review workbooks and review estimated spend."]
];

export function HomePage(): JSX.Element {
  const [studies, setStudies] = useState<StudyListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const result = await fetchStudies();
        if (!cancelled) {
          setStudies(result.studies.slice(0, 5));
        }
      } catch {
        if (!cancelled) {
          setStudies([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="home-page">
      <section className="home-hero">
        <div className="home-hero-copy">
          <span className="home-hero-chip">AI-assisted protocol deviation checks</span>
          <h1>
            Extract, review, and export protocol deviations with{" "}
            <span className="home-hero-accent">clinical confidence</span>
          </h1>
          <p>
            PD Check walks you from study setup through rule extraction, deviation review, and cost
            analysis — grounded in your protocol and aCRF.
          </p>
          <div className="home-hero-actions">
            <button
              type="button"
              className="button button-primary"
              onClick={() => navigateToPipelineStep("study-setup", { section: "study" })}
            >
              Start a study
            </button>
            <button
              type="button"
              className="button button-hero-secondary"
              onClick={() => navigateToPipelineStep("study-setup")}
            >
              <PipelineIcon size={18} />
              Open pipeline
            </button>
          </div>
        </div>
        <div className="home-hero-art" aria-hidden>
          <RhoMark className="home-hero-mark" />
        </div>
      </section>

      <div className="home-feature-grid">
        {features.map((feature) => (
          <article key={feature.title} className="home-feature-card">
            <div className="home-feature-icon" style={{ color: feature.color }}>
              {feature.icon}
            </div>
            <h3>{feature.title}</h3>
            <p>{feature.description}</p>
          </article>
        ))}
      </div>

      <div className={`home-lower-grid ${studies.length > 0 || loading ? "has-recent" : ""}`}>
        <Panel title="Getting Started" subtitle="Complete these steps for your first study">
          <ol className="home-steps">
            {gettingStarted.map(([title, detail]) => (
              <li key={title}>
                <strong>{title}</strong>
                <span>{detail}</span>
              </li>
            ))}
          </ol>
        </Panel>

        {loading ? (
          <Panel title="Recent studies">
            <p className="muted">Loading studies…</p>
          </Panel>
        ) : studies.length > 0 ? (
          <Panel
            title="Recent studies"
            subtitle="Pick up where you left off"
            actions={
              <button type="button" className="button button-secondary" onClick={() => navigateToApp("history")}>
                View all
              </button>
            }
          >
            <div className="home-study-list">
              {studies.map((study) => (
                <button
                  key={study.studyId}
                  type="button"
                  className="home-study-card"
                  onClick={() =>
                    navigateToPipelineStep("study-setup", {
                      section: "study",
                      studyId: study.studyId
                    })
                  }
                >
                  <strong>{study.studyId}</strong>
                  <span className="chip">{study.stage || study.workflowLabel || "Study"}</span>
                </button>
              ))}
            </div>
          </Panel>
        ) : null}
      </div>
    </div>
  );
}

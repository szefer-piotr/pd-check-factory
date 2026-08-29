import { useEffect, useState, type ReactNode } from "react";
import { RhoMark } from "../brand/RhoLogo";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import {
  CloseIcon,
  GuideIcon,
  HistoryIcon,
  HomeIcon,
  MenuIcon,
  PipelineIcon,
  SettingsIcon
} from "../ui/Icons";
import { usePipelineJobs } from "../../jobs/PipelineJobContext";
import { navigateToApp, type AppDestination } from "../../pipeline/appRoute";
import { navigateToPipelineStep } from "../../pipeline/pipelineRoute";
import type { PipelineStepId, StudySetupSection } from "../../pipeline/pipelineSteps";

interface NavItem {
  id: AppDestination;
  label: string;
  icon: ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  { id: "home", label: "Home", icon: <HomeIcon /> },
  { id: "pipeline", label: "Pipeline", icon: <PipelineIcon /> },
  { id: "guide", label: "Guide", icon: <GuideIcon /> },
  { id: "history", label: "History", icon: <HistoryIcon /> },
  { id: "settings", label: "Settings", icon: <SettingsIcon /> }
];

interface SetupChild {
  section: StudySetupSection;
  label: string;
  done: boolean;
}

interface AppShellProps {
  destination: AppDestination;
  children: ReactNode;
}

export function AppShell({ destination, children }: AppShellProps): JSX.Element {
  const [mobileOpen, setMobileOpen] = useState(false);
  const jobs = usePipelineJobs();
  const { nav, studyId } = jobs;
  const pipelineExpanded = destination === "pipeline";

  useEffect(() => {
    setMobileOpen(false);
  }, [destination, nav.stepId, nav.section]);

  function go(dest: AppDestination): void {
    if (dest === "pipeline") {
      navigateToPipelineStep("study-setup", {
        section: "study",
        studyId: studyId.trim() || undefined
      });
      return;
    }
    navigateToApp(dest);
  }

  function goPipeline(stepId: PipelineStepId, section?: StudySetupSection): void {
    if (!nav.canNavigateTo(stepId)) {
      return;
    }
    nav.navigate(stepId, section ? { section } : undefined);
  }

  const setupChildren: SetupChild[] = [
    { section: "study", label: "Study selection", done: nav.studySelected },
    { section: "config", label: "Configuration", done: nav.configSaved },
    { section: "processing", label: "Document extraction", done: nav.processingComplete }
  ];

  const pipelineChildren = (
    <nav className="app-nav-children-wrap" aria-label="Pipeline steps">
      <ul className="app-nav-children">
        <li className="app-nav-group">
          <button
            type="button"
            className={`app-nav-child app-nav-child-parent ${
              nav.stepId === "study-setup" ? "active" : ""
            } ${nav.studySelected && nav.configSaved && nav.processingComplete ? "done" : ""}`}
            onClick={() => goPipeline("study-setup", nav.section ?? "study")}
          >
            <span>Study setup</span>
            {nav.studySelected && nav.configSaved && nav.processingComplete ? (
              <span className="app-nav-check" aria-label="Done">
                ✓
              </span>
            ) : null}
          </button>
          <ul className="app-nav-grandchildren">
            {setupChildren.map((child) => {
              const active = nav.stepId === "study-setup" && nav.section === child.section;
              return (
                <li key={child.section}>
                  <button
                    type="button"
                    className={`app-nav-child app-nav-grandchild ${active ? "active" : ""} ${
                      child.done ? "done" : ""
                    }`}
                    onClick={() => goPipeline("study-setup", child.section)}
                  >
                    <span>{child.label}</span>
                    {child.done ? (
                      <span className="app-nav-check" aria-label="Done">
                        ✓
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </li>
        {(
          [
            { id: "rules" as const, label: "Rules", done: nav.rulesDone },
            { id: "deviations" as const, label: "Deviations", done: nav.deviationsDone },
            { id: "cost-analysis" as const, label: "Cost", done: nav.deviationsDone }
          ] as const
        ).map((item) => {
          const enabled = nav.canNavigateTo(item.id);
          const active = nav.stepId === item.id;
          return (
            <li key={item.id}>
              <button
                type="button"
                className={`app-nav-child ${active ? "active" : ""} ${item.done ? "done" : ""}`}
                disabled={!enabled}
                onClick={() => goPipeline(item.id)}
              >
                <span>{item.label}</span>
                {item.done ? (
                  <span className="app-nav-check" aria-label="Done">
                    ✓
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );

  const sidebar = (
    <div className="app-sidebar-inner">
      <div className="app-brand">
        <div className="app-brand-tile">
          <RhoMark className="app-brand-mark" />
        </div>
        <div className="app-brand-text">
          <strong>PD Check</strong>
          <span>Rho PD Assurance</span>
        </div>
      </div>

      <nav className="app-nav" aria-label="App">
        {NAV_ITEMS.map((item) => {
          const active = item.id === destination;
          return (
            <div key={item.id} className="app-nav-block">
              <button
                type="button"
                className={`app-nav-item ${active ? "active" : ""}`}
                onClick={() => go(item.id)}
                aria-expanded={item.id === "pipeline" ? pipelineExpanded : undefined}
              >
                <span className="app-nav-icon">{item.icon}</span>
                <span>{item.label}</span>
              </button>
              {item.id === "pipeline" && pipelineExpanded ? pipelineChildren : null}
            </div>
          );
        })}
      </nav>

      <div className="app-sidebar-footer">
        {studyId.trim() ? (
          <span className="chip app-sidebar-study" title={studyId.trim()}>
            {studyId.trim()}
          </span>
        ) : (
          <span className="app-sidebar-study-empty">No study selected</span>
        )}
        <button
          type="button"
          className="button button-secondary app-sidebar-cta"
          disabled={!studyId.trim() || jobs.isResetting}
          onClick={() => jobs.requestResetStudy()}
        >
          {jobs.isResetting ? "Resetting…" : "Reset study"}
        </button>
      </div>
    </div>
  );

  return (
    <div className="app-shell">
      <aside className="app-sidebar app-sidebar-desktop">{sidebar}</aside>

      {mobileOpen ? (
        <div className="app-drawer">
          <button
            type="button"
            className="app-drawer-backdrop"
            aria-label="Close menu"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="app-sidebar app-sidebar-mobile">{sidebar}</aside>
        </div>
      ) : null}

      <div className="app-main">
        <header className="app-mobile-topbar">
          <button
            type="button"
            className="button button-ghost app-menu-button"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            onClick={() => setMobileOpen((open) => !open)}
          >
            {mobileOpen ? <CloseIcon /> : <MenuIcon />}
          </button>
          <strong>PD Check</strong>
        </header>
        <div className={`app-content ${destination === "pipeline" ? "app-content-wide" : ""}`}>{children}</div>
        <p className="app-caption">© Rho PD Check</p>
      </div>

      <ConfirmDialog
        open={jobs.resetConfirmOpen}
        title="Reset study?"
        confirmLabel="Reset study"
        danger
        busy={jobs.isResetting}
        onConfirm={() => void jobs.confirmResetStudy()}
        onCancel={() => jobs.cancelResetStudy()}
      >
        <p>
          Reset study <strong>{studyId.trim() || "—"}</strong>? This permanently deletes all blob and local
          artifacts for this study.
        </p>
        <p className="muted">Chat history and deviations will be lost. This cannot be undone.</p>
      </ConfirmDialog>
    </div>
  );
}

import type { LlmProgress } from "../../services/stepApi";

const PHASE_LABELS: Record<string, string> = {
  "acrf-summary": "Merging aCRF summary",
  "extract-rules": "Extracting rules",
  "extract-deviations": "Generating deviations",
  "normalize-checks": "Normalizing checks",
  "classify-programmability": "Classifying programmability",
  "pseudo-logic": "Generating pseudo logic",
  "pd-enrich": "Enriching PD specifications"
};

const UNIT_LABELS: Record<string, string> = {
  sections: "sections",
  rules: "rules",
  deviations: "deviations",
  phases: "phases"
};

interface LlmProgressBarProps {
  progress: LlmProgress;
}

export function LlmProgressBar({ progress }: LlmProgressBarProps): JSX.Element | null {
  if (!progress.total || progress.total <= 0) {
    return null;
  }

  const ratio = Math.min(1, Math.max(0, progress.current / progress.total));
  const percent = Math.round(ratio * 100);
  const phaseLabel = PHASE_LABELS[progress.phase] ?? progress.phase;
  const unitLabel = UNIT_LABELS[progress.unit] ?? progress.unit;
  const detail = progress.label ? ` (${progress.label})` : "";

  return (
    <div className="llm-progress-bar" role="progressbar" aria-valuenow={progress.current} aria-valuemin={0} aria-valuemax={progress.total}>
      <div className="llm-progress-bar-header">
        <span className="llm-progress-bar-label">
          {phaseLabel} — {progress.current} / {progress.total} {unitLabel}
          {detail}
        </span>
        <span className="llm-progress-bar-percent">{percent}%</span>
      </div>
      <div className="llm-progress-bar-track" aria-hidden="true">
        <span className="llm-progress-bar-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

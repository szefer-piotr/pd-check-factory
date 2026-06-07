import { useEffect, useState } from "react";
import { fetchStepPreview, type StepPreviewResponse } from "../../services/stepApi";
import { StepPreview } from "./StepPreview";

interface LiveExtractionPanelProps {
  studyId: string;
  active: boolean;
}

function hasPreviewBody(response: StepPreviewResponse | null): boolean {
  if (!response) {
    return false;
  }
  return response.previews.some((preview) => preview.body.trim().length > 0);
}

export function LiveExtractionPanel({ studyId, active }: LiveExtractionPanelProps): JSX.Element | null {
  const [rulesPreview, setRulesPreview] = useState<StepPreviewResponse | null>(null);
  const [deviationsPreview, setDeviationsPreview] = useState<StepPreviewResponse | null>(null);

  useEffect(() => {
    if (!active || !studyId.trim()) {
      setRulesPreview(null);
      setDeviationsPreview(null);
      return;
    }

    let cancelled = false;
    const poll = async (): Promise<void> => {
      try {
        const [rules, deviations] = await Promise.all([
          fetchStepPreview(studyId.trim(), "extract-rules"),
          fetchStepPreview(studyId.trim(), "extract-deviations")
        ]);
        if (cancelled) {
          return;
        }
        if (hasPreviewBody(rules)) {
          setRulesPreview(rules);
        }
        if (hasPreviewBody(deviations)) {
          setDeviationsPreview(deviations);
        }
      } catch {
        // best-effort live preview polling
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [active, studyId]);

  if (!active || (!hasPreviewBody(rulesPreview) && !hasPreviewBody(deviationsPreview))) {
    return null;
  }

  const deviationCount = deviationsPreview?.itemCount ?? 0;
  const ruleCount = rulesPreview?.itemCount ?? 0;

  return (
    <section className="live-extraction-panel" aria-label="Live extraction results">
      <header className="live-extraction-panel-header">
        <h3 className="live-extraction-panel-title">Live extraction results</h3>
        <div className="live-extraction-panel-counts">
          {ruleCount > 0 ? (
            <span className="live-extraction-count">
              Rules <strong>{ruleCount}</strong>
            </span>
          ) : null}
          {deviationCount > 0 ? (
            <span className="live-extraction-count">
              Deviations <strong>{deviationCount}</strong>
              {deviationsPreview?.partial ? <span className="live-extraction-partial">updating…</span> : null}
            </span>
          ) : null}
        </div>
      </header>

      {hasPreviewBody(rulesPreview) ? (
        <StepPreview stepId="extract-rules" previews={rulesPreview!.previews} hasRun />
      ) : null}
      {hasPreviewBody(deviationsPreview) ? (
        <StepPreview stepId="extract-deviations" previews={deviationsPreview!.previews} hasRun />
      ) : null}
    </section>
  );
}

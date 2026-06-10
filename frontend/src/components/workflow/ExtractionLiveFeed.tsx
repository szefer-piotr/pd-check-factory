import { useMemo } from "react";
import { LlmProgressBar } from "./LlmProgressBar";
import type { ExtractionLiveResponse, Step1RunStateResponse } from "../../services/stepApi";

interface ExtractionLiveFeedProps {
  studyId: string;
  active: boolean;
  live?: ExtractionLiveResponse | null;
  runState?: Step1RunStateResponse | null;
  onSelectDeviation?: (deviationId: string) => void;
}

interface RuleGroup {
  ruleId: string;
  title: string;
  text: string;
  deviations: ExtractionLiveResponse["deviations"];
}

function groupByRule(live: ExtractionLiveResponse | null): RuleGroup[] {
  if (!live) {
    return [];
  }
  const ruleById = new Map(live.rules.map((rule) => [rule.rule_id, rule]));
  const grouped = new Map<string, ExtractionLiveResponse["deviations"]>();

  for (const deviation of live.deviations) {
    const existing = grouped.get(deviation.rule_id) ?? [];
    existing.push(deviation);
    grouped.set(deviation.rule_id, existing);
  }

  const orderedRuleIds = live.rules.map((rule) => rule.rule_id);
  for (const ruleId of grouped.keys()) {
    if (!orderedRuleIds.includes(ruleId)) {
      orderedRuleIds.push(ruleId);
    }
  }

  return orderedRuleIds
    .filter((ruleId) => grouped.has(ruleId))
    .map((ruleId) => {
      const rule = ruleById.get(ruleId);
      return {
        ruleId,
        title: rule?.title ?? ruleId,
        text: rule?.text ?? "",
        deviations: grouped.get(ruleId) ?? []
      };
    });
}

function hasLiveContent(live: ExtractionLiveResponse | null): boolean {
  if (!live) {
    return false;
  }
  return live.ruleCount > 0 || live.deviationCount > 0;
}

function feedLlmProgress(
  live: ExtractionLiveResponse | null,
  runState: Step1RunStateResponse | null | undefined
): ExtractionLiveResponse["llmProgress"] {
  const runProgress = runState?.llmProgress ?? null;
  const currentSubStep = runState?.currentSubStepId ?? "";
  if (
    runProgress &&
    (currentSubStep === "acrf-summary-text" || currentSubStep === "extract-deviations")
  ) {
    return null;
  }
  return live?.llmProgress ?? null;
}

export function ExtractionLiveFeed({
  active,
  live = null,
  runState = null,
  onSelectDeviation
}: ExtractionLiveFeedProps): JSX.Element | null {
  const groups = useMemo(() => groupByRule(live), [live]);
  const streamProgress = feedLlmProgress(live, runState);

  if (!active) {
    return null;
  }

  const runStatus = live?.runStatus ?? runState?.status ?? "idle";
  const showFeed =
    hasLiveContent(live) || live?.partial === true || runStatus === "running";

  if (!showFeed) {
    return null;
  }

  if (!hasLiveContent(live) && !live?.partial) {
    return streamProgress ? (
      <section className="extraction-live-feed" aria-label="Live extraction results">
        <LlmProgressBar progress={streamProgress} />
      </section>
    ) : null;
  }

  return (
    <section className="extraction-live-feed" aria-label="Live extraction results">
      <header className="extraction-live-feed-header">
        <h3 className="extraction-live-feed-title">Live extraction results</h3>
        <div className="extraction-live-feed-counts">
          {(live?.ruleCount ?? 0) > 0 ? (
            <span className="extraction-live-feed-count">
              Rules <strong>{live!.ruleCount}</strong>
            </span>
          ) : null}
          {(live?.deviationCount ?? 0) > 0 ? (
            <span className="extraction-live-feed-count">
              Deviations <strong>{live!.deviationCount}</strong>
              {live!.partial ? <span className="extraction-live-feed-partial">updating…</span> : null}
            </span>
          ) : null}
        </div>
      </header>

      {streamProgress ? <LlmProgressBar progress={streamProgress} /> : null}

      {(live?.rules.length ?? 0) > 0 ? (
        <section className="extraction-live-feed-rules" aria-label="Extracted rules">
          <h4 className="extraction-live-feed-section-title">Rules</h4>
          <ul className="extraction-live-feed-rule-list">
            {live!.rules.map((rule) => (
              <li key={rule.rule_id} className="extraction-live-feed-rule-item">
                <div className="extraction-live-feed-rule-heading">
                  <span className="extraction-live-feed-rule-id">{rule.rule_id}</span>
                  {rule.title ? <span className="extraction-live-feed-rule-title">{rule.title}</span> : null}
                </div>
                <p className="extraction-live-feed-rule-text">{rule.text}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {groups.length > 0 ? (
        <section className="extraction-live-feed-deviations" aria-label="Extracted deviations">
          <h4 className="extraction-live-feed-section-title">Deviations</h4>
          {groups.map((group) => (
            <div key={group.ruleId} className="extraction-live-feed-rule-group">
              <h5 className="extraction-live-feed-group-title">
                {group.ruleId}
                {group.title ? ` — ${group.title}` : ""}
              </h5>
              <ul className="extraction-live-feed-deviation-list">
                {group.deviations.map((deviation) => (
                  <li key={deviation.deviation_id} className="extraction-live-feed-deviation-item">
                    <button
                      type="button"
                      className="extraction-live-feed-deviation-button"
                      onClick={() => onSelectDeviation?.(deviation.deviation_id)}
                    >
                      <div className="extraction-live-feed-deviation-heading">
                        <span className="extraction-live-feed-deviation-id">{deviation.deviation_id}</span>
                        <span className="extraction-live-feed-deviation-rule">{deviation.rule_id}</span>
                      </div>
                      <p className="extraction-live-feed-deviation-text">{deviation.text}</p>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ) : null}
    </section>
  );
}

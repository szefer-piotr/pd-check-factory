import { useEffect, useMemo, useState } from "react";
import { JsonViewer } from "../../components/viewers/JsonViewer";
import { ParagraphRefList, RuleRefChip } from "../../components/viewers/RefChip";
import { TextFileViewer } from "../../components/viewers/TextFileViewer";
import { StepPage, type StepTabDef } from "../../components/workflow/StepPage";
import {
  ArtifactNotFoundError,
  fetchArtifactJson,
  type DeviationEntry,
  type DeviationsParsedJson,
  type RuleEntry,
  type RulesParsedJson
} from "../../services/artifactApi";
import { countDetail, dependencyInfos, stepNavStatus, type WorkflowStepPageContext } from "./common";

interface ExtractDeviationsStepPageProps extends WorkflowStepPageContext {
  llmInstructions: string;
  onLlmInstructionsChange: (value: string) => void;
}

/** #/extract-deviations — per-rule accordion of deviation candidates. */
export function ExtractDeviationsStepPage(props: ExtractDeviationsStepPageProps): JSX.Element {
  const {
    studyId,
    stepInfo,
    backendStatuses,
    runState,
    isStepRunning,
    runError,
    onRun,
    goPrev,
    goNext,
    prevLabel,
    nextLabel,
    focus,
    tabParam,
    llmInstructions,
    onLlmInstructionsChange
  } = props;
  const trimmed = studyId.trim();
  const hasOutput = stepInfo?.status === "done";
  const status = stepNavStatus(stepInfo, isStepRunning, Boolean(runError));

  const [deviations, setDeviations] = useState<DeviationEntry[] | null>(null);
  const [rules, setRules] = useState<RuleEntry[]>([]);
  const [loadError, setLoadError] = useState("");
  const [openRules, setOpenRules] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setDeviations(null);
    setLoadError("");
    if (!trimmed || !hasOutput) {
      return;
    }
    Promise.all([
      fetchArtifactJson<DeviationsParsedJson>(trimmed, "deviations-parsed"),
      fetchArtifactJson<RulesParsedJson>(trimmed, "rules-parsed").catch(() => ({ rules: [] }) as unknown as RulesParsedJson)
    ])
      .then(([parsed, rulesParsed]) => {
        if (cancelled) {
          return;
        }
        setDeviations(parsed.deviations ?? []);
        setRules(rulesParsed.rules ?? []);
        const first = (parsed.deviations ?? [])[0];
        setOpenRules(new Set(first ? [first.rule_id] : []));
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        if (!(error instanceof ArtifactNotFoundError)) {
          setLoadError(error instanceof Error ? error.message : "Unable to load deviations.");
        }
        setDeviations([]);
      });
    return () => {
      cancelled = true;
    };
  }, [trimmed, hasOutput, isStepRunning]);

  useEffect(() => {
    if (!focus || !deviations) {
      return;
    }
    const target = deviations.find((deviation) => deviation.deviation_id === focus);
    if (target) {
      setOpenRules((previous) => new Set([...previous, target.rule_id]));
      window.setTimeout(() => {
        document.getElementById(`deviation-${focus}`)?.scrollIntoView({ block: "center" });
      }, 50);
    }
  }, [focus, deviations]);

  const byRule = useMemo(() => {
    const groups = new Map<string, DeviationEntry[]>();
    for (const deviation of deviations ?? []) {
      const list = groups.get(deviation.rule_id) ?? [];
      list.push(deviation);
      groups.set(deviation.rule_id, list);
    }
    return groups;
  }, [deviations]);

  const ruleTitle = useMemo(() => {
    const map = new Map<string, string>();
    for (const rule of rules) {
      map.set(rule.rule_id, rule.title);
    }
    return map;
  }, [rules]);

  function toggleRule(ruleId: string): void {
    setOpenRules((previous) => {
      const next = new Set(previous);
      if (next.has(ruleId)) {
        next.delete(ruleId);
      } else {
        next.add(ruleId);
      }
      return next;
    });
  }

  const tabs = useMemo<StepTabDef[]>(() => {
    if (!trimmed) {
      return [];
    }
    return [
      {
        id: "deviations",
        label: "Deviations",
        isArtifact: true,
        render: () => {
          if (loadError) {
            return <p className="step1-error">{loadError}</p>;
          }
          if (deviations === null) {
            return <p className="step1-status">Loading deviations…</p>;
          }
          if (deviations.length === 0) {
            return <p className="step7-muted">No deviation candidates extracted.</p>;
          }
          return (
            <div className="deviations-accordion">
              {[...byRule.entries()].map(([ruleId, list]) => {
                const isOpen = openRules.has(ruleId);
                return (
                  <div key={ruleId} className="deviation-rule-group">
                    <button type="button" className="deviation-rule-header" onClick={() => toggleRule(ruleId)}>
                      <span>
                        <RuleRefChip ruleId={ruleId} />
                        <span className="deviation-rule-title"> {ruleTitle.get(ruleId) ?? ""}</span>
                      </span>
                      <span className="step7-muted">
                        {list.length} candidates {isOpen ? "▾" : "▸"}
                      </span>
                    </button>
                    {isOpen
                      ? list.map((deviation) => (
                          <article
                            key={deviation.deviation_id}
                            id={`deviation-${deviation.deviation_id}`}
                            className={`deviation-card ${deviation.deviation_id === focus ? "deviation-card-focused" : ""}`}
                          >
                            <header className="deviation-card-header">
                              <span className="rule-card-id">{deviation.deviation_id}</span>
                              <ParagraphRefList refs={deviation.paragraph_refs} />
                            </header>
                            <p className="deviation-card-text">{deviation.text}</p>
                            {deviation.data_support_note ? (
                              <p className="step7-muted deviation-card-note">{deviation.data_support_note}</p>
                            ) : null}
                          </article>
                        ))
                      : null}
                  </div>
                );
              })}
            </div>
          );
        }
      },
      {
        id: "deviations-json",
        label: "deviations_parsed.json",
        isArtifact: true,
        render: () => <JsonViewer studyId={trimmed} artifact="deviations-parsed" />
      },
      {
        id: "review-state-json",
        label: "deviations_review_state.json",
        isArtifact: true,
        render: () => <JsonViewer studyId={trimmed} artifact="deviations-review-state" />
      },
      {
        id: "deviations-raw",
        label: "deviations_raw.txt",
        isArtifact: true,
        render: () => <TextFileViewer studyId={trimmed} artifact="deviations-raw" />
      }
    ];
  }, [trimmed, deviations, loadError, byRule, openRules, ruleTitle, focus]);

  const llmProgress = runState?.llmProgress;
  const runningInfo = (
    <div className="step-running-panel">
      {llmProgress && llmProgress.total > 0 ? (
        <>
          <div className="progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={llmProgress.total} aria-valuenow={llmProgress.current}>
            <div className="progress-bar-fill" style={{ width: `${Math.round((llmProgress.current / llmProgress.total) * 100)}%` }} />
          </div>
          <p className="step1-status">
            Analyzing rule {Math.min(llmProgress.current, llmProgress.total)} of {llmProgress.total}
            {llmProgress.label ? ` — ${llmProgress.label}` : ""}
          </p>
        </>
      ) : (
        <p className="step1-status">{runState?.message || "Extracting deviation candidates…"}</p>
      )}
    </div>
  );

  const controls = (
    <label className="control-group llm-instructions-group">
      <span className="control-label">Additional LLM instructions (optional, applied on next run)</span>
      <textarea
        className="input llm-instructions-textarea"
        rows={2}
        value={llmInstructions}
        onChange={(event) => onLlmInstructionsChange(event.target.value)}
        placeholder="e.g. Prefer deviations detectable from the listed datasets…"
        disabled={isStepRunning}
      />
    </label>
  );

  const banner =
    hasOutput && deviations !== null && deviations.length > 0 ? (
      <p className="step-banner-info">{deviations.length} candidates initialized for review.</p>
    ) : undefined;

  return (
    <StepPage
      title="Deviation candidates"
      description="Candidate deviations are generated per rule and seeded into the review state for the Review phase."
      status={status}
      statusDetail={countDetail(stepInfo)}
      onRun={onRun}
      isRunning={isStepRunning}
      dependencies={dependencyInfos(stepInfo, backendStatuses)}
      hasOutput={hasOutput}
      banner={
        <>
          {runError ? <p className="step1-error">{runError}</p> : null}
          {banner}
        </>
      }
      controls={controls}
      runningInfo={runningInfo}
      tabs={tabs}
      initialTabId={focus ? "deviations" : tabParam}
      onPrev={goPrev}
      onNext={goNext}
      prevLabel={prevLabel}
      nextLabel={nextLabel}
    />
  );
}

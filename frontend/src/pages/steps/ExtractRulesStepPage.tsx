import { useEffect, useMemo, useState } from "react";
import { JsonViewer } from "../../components/viewers/JsonViewer";
import { ParagraphViewer } from "../../components/viewers/ParagraphViewer";
import { ParagraphRefList } from "../../components/viewers/RefChip";
import { TextFileViewer } from "../../components/viewers/TextFileViewer";
import { StepPage, type StepTabDef } from "../../components/workflow/StepPage";
import {
  ArtifactNotFoundError,
  fetchArtifactJson,
  type RuleEntry,
  type RulesParsedJson
} from "../../services/artifactApi";
import { countDetail, dependencyInfos, stepNavStatus, type WorkflowStepPageContext } from "./common";

interface ExtractRulesStepPageProps extends WorkflowStepPageContext {
  llmInstructions: string;
  onLlmInstructionsChange: (value: string) => void;
}

/** #/extract-rules — rule cards beside an embedded paragraph evidence viewer. */
export function ExtractRulesStepPage(props: ExtractRulesStepPageProps): JSX.Element {
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

  const [rules, setRules] = useState<RuleEntry[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [selectedRuleId, setSelectedRuleId] = useState<string>(focus ?? "");
  const [focusParagraph, setFocusParagraph] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (focus) {
      setSelectedRuleId(focus);
    }
  }, [focus]);

  useEffect(() => {
    let cancelled = false;
    setRules(null);
    setLoadError("");
    if (!trimmed || !hasOutput) {
      return;
    }
    fetchArtifactJson<RulesParsedJson>(trimmed, "rules-parsed")
      .then((parsed) => {
        if (!cancelled) {
          setRules(parsed.rules ?? []);
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        if (!(error instanceof ArtifactNotFoundError)) {
          setLoadError(error instanceof Error ? error.message : "Unable to load rules.");
        }
        setRules([]);
      });
    return () => {
      cancelled = true;
    };
  }, [trimmed, hasOutput, isStepRunning]);

  const selectedRule = useMemo(
    () => rules?.find((rule) => rule.rule_id === selectedRuleId) ?? null,
    [rules, selectedRuleId]
  );

  const tabs = useMemo<StepTabDef[]>(() => {
    if (!trimmed) {
      return [];
    }
    return [
      {
        id: "rules",
        label: "Rules",
        isArtifact: true,
        render: () => {
          if (loadError) {
            return <p className="step1-error">{loadError}</p>;
          }
          if (rules === null) {
            return <p className="step1-status">Loading rules…</p>;
          }
          if (rules.length === 0) {
            return <p className="step7-muted">No rules extracted.</p>;
          }
          return (
            <div className="rules-split">
              <div className="rules-list">
                {rules.map((rule) => (
                  <article
                    key={rule.rule_id}
                    className={`rule-card ${rule.rule_id === selectedRuleId ? "rule-card-active" : ""}`}
                    onClick={() => setSelectedRuleId(rule.rule_id)}
                  >
                    <header className="rule-card-header">
                      <span className="rule-card-id">{rule.rule_id}</span>
                      <strong className="rule-card-title">{rule.title}</strong>
                    </header>
                    <p className="rule-card-text">{rule.text}</p>
                    <div className="rule-card-refs">
                      <ParagraphRefList
                        refs={rule.paragraph_refs}
                        onOpen={(refId) => {
                          setSelectedRuleId(rule.rule_id);
                          setFocusParagraph(refId);
                        }}
                      />
                    </div>
                    {rule.coverage_note ? <p className="step7-muted rule-card-note">{rule.coverage_note}</p> : null}
                  </article>
                ))}
              </div>
              <div className="rules-evidence">
                <p className="compare-pane-title">
                  {selectedRule
                    ? `Evidence paragraphs for ${selectedRule.rule_id}`
                    : "Select a rule to highlight its evidence paragraphs"}
                </p>
                <ParagraphViewer
                  studyId={trimmed}
                  focusRef={focusParagraph ?? selectedRule?.paragraph_refs[0]}
                  highlightRefs={selectedRule?.paragraph_refs ?? []}
                />
              </div>
            </div>
          );
        }
      },
      {
        id: "rules-json",
        label: "rules_parsed.json",
        isArtifact: true,
        render: () => <JsonViewer studyId={trimmed} artifact="rules-parsed" />
      },
      {
        id: "rules-raw",
        label: "rules_raw.txt",
        isArtifact: true,
        render: () => <TextFileViewer studyId={trimmed} artifact="rules-raw" />
      }
    ];
  }, [trimmed, rules, loadError, selectedRuleId, selectedRule, focusParagraph]);

  const controls = (
    <label className="control-group llm-instructions-group">
      <span className="control-label">Additional LLM instructions (optional, applied on next run)</span>
      <textarea
        className="input llm-instructions-textarea"
        rows={2}
        value={llmInstructions}
        onChange={(event) => onLlmInstructionsChange(event.target.value)}
        placeholder="e.g. Focus on visit-window and dosing rules…"
        disabled={isStepRunning}
      />
    </label>
  );

  return (
    <StepPage
      title="Rule extraction"
      description="Atomic, testable protocol rules with paragraph references. Invalid references are filtered out by the pipeline."
      status={status}
      statusDetail={countDetail(stepInfo)}
      onRun={onRun}
      isRunning={isStepRunning}
      dependencies={dependencyInfos(stepInfo, backendStatuses)}
      hasOutput={hasOutput}
      banner={runError ? <p className="step1-error">{runError}</p> : undefined}
      controls={controls}
      runningInfo={<p className="step1-status">{runState?.message || "Extracting rules…"}</p>}
      tabs={tabs}
      initialTabId={focus ? "rules" : tabParam}
      onPrev={goPrev}
      onNext={goNext}
      prevLabel={prevLabel}
      nextLabel={nextLabel}
    />
  );
}

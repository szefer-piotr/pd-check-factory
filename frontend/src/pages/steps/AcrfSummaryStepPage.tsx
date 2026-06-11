import { useEffect, useMemo, useState } from "react";
import { JsonViewer } from "../../components/viewers/JsonViewer";
import { StepPage, type StepTabDef } from "../../components/workflow/StepPage";
import {
  ArtifactNotFoundError,
  fetchArtifactJson,
  type AcrfDatasetEntry,
  type AcrfSummaryMergedJson
} from "../../services/artifactApi";
import { countDetail, dependencyInfos, stepNavStatus, type WorkflowStepPageContext } from "./common";

interface DatasetsTableProps {
  datasets: AcrfDatasetEntry[];
  focusDataset?: string;
}

function DatasetsTable({ datasets, focusDataset }: DatasetsTableProps): JSX.Element {
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(focusDataset ? [focusDataset] : [])
  );
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (focusDataset) {
      setExpanded((previous) => new Set([...previous, focusDataset]));
      const element = document.getElementById(`dataset-${focusDataset}`);
      element?.scrollIntoView({ block: "center" });
    }
  }, [focusDataset]);

  const visible = useMemo(() => {
    const trimmed = filter.trim().toLowerCase();
    if (!trimmed) {
      return datasets;
    }
    return datasets.filter(
      (dataset) =>
        dataset.dataset_name.toLowerCase().includes(trimmed) ||
        dataset.columns.some((column) => column.column_name.toLowerCase().includes(trimmed))
    );
  }, [datasets, filter]);

  function toggle(name: string): void {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }

  return (
    <div className="datasets-table">
      <div className="datasets-table-toolbar">
        <input
          className="input"
          type="search"
          placeholder="Filter datasets / columns…"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          aria-label="Filter datasets"
        />
        <span className="chip">{visible.length} datasets</span>
      </div>
      {visible.map((dataset) => {
        const isOpen = expanded.has(dataset.dataset_name);
        const isFocused = dataset.dataset_name === focusDataset;
        return (
          <div
            key={dataset.dataset_name}
            id={`dataset-${dataset.dataset_name}`}
            className={`dataset-card ${isFocused ? "dataset-card-focused" : ""}`}
          >
            <button type="button" className="dataset-card-header" onClick={() => toggle(dataset.dataset_name)}>
              <span className="dataset-card-name">{dataset.dataset_name}</span>
              <span className="step7-muted">
                {dataset.columns.length} columns {isOpen ? "▾" : "▸"}
              </span>
            </button>
            {isOpen ? (
              <table className="rendered-table dataset-columns-table">
                <thead>
                  <tr>
                    <th>column</th>
                    <th>description</th>
                    <th>values</th>
                  </tr>
                </thead>
                <tbody>
                  {dataset.columns.map((column) => (
                    <tr key={column.column_name}>
                      <td className="rendered-table-mono">{column.column_name}</td>
                      <td>{column.column_description ?? ""}</td>
                      <td className="rendered-table-mono">{column.column_values ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </div>
        );
      })}
      {visible.length === 0 ? <p className="step7-muted">No datasets match the filter.</p> : null}
    </div>
  );
}

/** #/acrf-summary-text — dataset summaries with progress-first running view. */
export function AcrfSummaryStepPage(props: WorkflowStepPageContext): JSX.Element {
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
    tabParam
  } = props;
  const trimmed = studyId.trim();
  const hasOutput = stepInfo?.status === "done";
  const status = stepNavStatus(stepInfo, isStepRunning, Boolean(runError));

  const [datasets, setDatasets] = useState<AcrfDatasetEntry[] | null>(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setDatasets(null);
    setLoadError("");
    if (!trimmed || !hasOutput) {
      return;
    }
    fetchArtifactJson<AcrfSummaryMergedJson>(trimmed, "acrf-summary-merged")
      .then((merged) => {
        if (!cancelled) {
          setDatasets(merged.datasets ?? []);
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        if (!(error instanceof ArtifactNotFoundError)) {
          setLoadError(error instanceof Error ? error.message : "Unable to load dataset summaries.");
        }
        setDatasets([]);
      });
    return () => {
      cancelled = true;
    };
  }, [trimmed, hasOutput, isStepRunning]);

  const tabs = useMemo<StepTabDef[]>(() => {
    if (!trimmed) {
      return [];
    }
    return [
      {
        id: "datasets",
        label: "Datasets",
        isArtifact: true,
        render: () => {
          if (loadError) {
            return <p className="step1-error">{loadError}</p>;
          }
          if (datasets === null) {
            return <p className="step1-status">Loading datasets…</p>;
          }
          return <DatasetsTable datasets={datasets} focusDataset={focus} />;
        }
      },
      {
        id: "raw-json",
        label: "acrf_summary_text_merged.json",
        isArtifact: true,
        render: () => <JsonViewer studyId={trimmed} artifact="acrf-summary-merged" />
      }
    ];
  }, [trimmed, datasets, loadError, focus]);

  const llmProgress = runState?.llmProgress;
  const runningInfo = (
    <div className="step-running-panel">
      {llmProgress && llmProgress.total > 0 ? (
        <>
          <div className="progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={llmProgress.total} aria-valuenow={llmProgress.current}>
            <div className="progress-bar-fill" style={{ width: `${Math.round((llmProgress.current / llmProgress.total) * 100)}%` }} />
          </div>
          <p className="step1-status">
            Summarizing section {Math.min(llmProgress.current, llmProgress.total)} of {llmProgress.total}
            {llmProgress.label ? ` — ${llmProgress.label}` : ""}
          </p>
        </>
      ) : (
        <p className="step1-status">{runState?.message || "Summarizing aCRF sections…"}</p>
      )}
    </div>
  );

  return (
    <StepPage
      title="Dataset summaries"
      description="Each aCRF section is summarized into dataset/column structures used as evidence context downstream."
      status={status}
      statusDetail={countDetail(stepInfo)}
      onRun={onRun}
      isRunning={isStepRunning}
      dependencies={dependencyInfos(stepInfo, backendStatuses)}
      hasOutput={hasOutput}
      banner={runError ? <p className="step1-error">{runError}</p> : undefined}
      runningInfo={runningInfo}
      tabs={tabs}
      initialTabId={focus ? "datasets" : tabParam}
      onPrev={goPrev}
      onNext={goNext}
      prevLabel={prevLabel}
      nextLabel={nextLabel}
    />
  );
}

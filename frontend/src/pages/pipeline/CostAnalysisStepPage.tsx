import { useCallback, useEffect, useMemo, useState } from "react";
import { Panel } from "../../components/layout/Panel";
import {
  fetchCostUsage,
  type CostStepBucket,
  type CostUsageResponse
} from "../../services/stepApi";

interface CostAnalysisStepPageProps {
  studyId: string;
}

function formatUsd(value: number | null | undefined): string {
  if (value == null || Number.isNaN(Number(value))) {
    return "—";
  }
  const amount = Number(value);
  if (amount === 0) {
    return "$0.00";
  }
  if (amount < 0.01) {
    return `$${amount.toFixed(4)}`;
  }
  return `$${amount.toFixed(2)}`;
}

function formatInt(value: number | null | undefined): string {
  return Number(value || 0).toLocaleString();
}

function stepRows(byStep: Record<string, CostStepBucket>): Array<{ step: string; bucket: CostStepBucket }> {
  return Object.entries(byStep)
    .map(([step, bucket]) => ({ step, bucket }))
    .sort((a, b) => a.step.localeCompare(b.step));
}

export function CostAnalysisStepPage({ studyId }: CostAnalysisStepPageProps): JSX.Element {
  const [data, setData] = useState<CostUsageResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (): Promise<void> => {
    if (!studyId.trim()) {
      setData(null);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await fetchCostUsage(studyId.trim());
      setData(result);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load cost usage.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [studyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => stepRows(data?.byStep ?? {}), [data]);
  const llm = data?.totals?.llm;
  const di = data?.totals?.document_intelligence;

  return (
    <div className="pipeline-step-page cost-analysis-page">
      <header className="page-hero page-hero-row">
        <div>
          <h1>Cost analysis</h1>
          <p>
            Estimated Azure OpenAI and Document Intelligence spend accumulated for this study. Rates are configurable
            estimates, not Azure invoice amounts.
          </p>
        </div>
        <button
          type="button"
          className="button button-secondary"
          disabled={!studyId.trim() || loading}
          onClick={() => void load()}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      {error ? <p className="pipeline-error">{error}</p> : null}

      {!studyId.trim() ? <p className="pipeline-hint">Select a study first.</p> : null}

      {studyId.trim() && loading && !data ? <p className="muted">Loading cost usage…</p> : null}

      {data && !data.available ? (
        <Panel title="No usage yet">
          <p className="pipeline-hint">
            No cost usage recorded yet for this study. Run PDF extraction or LLM pipeline steps to populate{" "}
            <code>pipeline/pipeline_cost_usage.json</code>.
          </p>
        </Panel>
      ) : null}

      {data?.available ? (
        <div className="cost-page-stack">
          <Panel
            title="Totals"
            subtitle={`Pricing: ${data.pricingSource ?? "defaults"} · Updated ${data.updatedAt ?? "—"} · ${formatInt(data.eventCount)} events`}
          >
            <div className="cost-metrics-grid">
              <div className="cost-metric">
                <span className="metric-label">Total estimated</span>
                <strong className="metric-value">{formatUsd(data.totals.cost_usd)}</strong>
              </div>
              <div className="cost-metric">
                <span className="metric-label">LLM cost</span>
                <strong className="metric-value">{formatUsd(llm?.cost_usd)}</strong>
              </div>
              <div className="cost-metric">
                <span className="metric-label">Document Intelligence</span>
                <strong className="metric-value">{formatUsd(di?.cost_usd)}</strong>
              </div>
              <div className="cost-metric">
                <span className="metric-label">LLM calls</span>
                <strong className="metric-value">{formatInt(llm?.calls)}</strong>
              </div>
              <div className="cost-metric">
                <span className="metric-label">Prompt tokens</span>
                <strong className="metric-value">{formatInt(llm?.prompt_tokens)}</strong>
              </div>
              <div className="cost-metric">
                <span className="metric-label">Completion tokens</span>
                <strong className="metric-value">{formatInt(llm?.completion_tokens)}</strong>
              </div>
              <div className="cost-metric">
                <span className="metric-label">DI pages</span>
                <strong className="metric-value">{formatInt(di?.pages)}</strong>
              </div>
              <div className="cost-metric">
                <span className="metric-label">DI calls</span>
                <strong className="metric-value">{formatInt(di?.calls)}</strong>
              </div>
            </div>
            <p className="pipeline-hint cost-artifact-path">
              Artifact: <code>{data.artifactPath}</code>
            </p>
          </Panel>

          <Panel title="By step" noPadding>
            {rows.length === 0 ? (
              <p className="pipeline-hint" style={{ padding: "1.25rem" }}>
                No per-step breakdown yet.
              </p>
            ) : (
              <div className="cost-table-wrap">
                <table className="cost-table">
                  <thead>
                    <tr>
                      <th>Step</th>
                      <th>LLM calls</th>
                      <th>Tokens</th>
                      <th>LLM $</th>
                      <th>DI pages</th>
                      <th>DI $</th>
                      <th>Step $</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ step, bucket }) => (
                      <tr key={step}>
                        <td>{step}</td>
                        <td>{formatInt(bucket.llm?.calls)}</td>
                        <td>{formatInt(bucket.llm?.total_tokens)}</td>
                        <td>{formatUsd(bucket.llm?.cost_usd)}</td>
                        <td>{formatInt(bucket.document_intelligence?.pages)}</td>
                        <td>{formatUsd(bucket.document_intelligence?.cost_usd)}</td>
                        <td>{formatUsd(bucket.cost_usd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
      ) : null}
    </div>
  );
}

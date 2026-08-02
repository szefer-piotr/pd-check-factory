import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "../../components/layout/Card";
import { Stack } from "../../components/layout/Stack";
import { MetricCard } from "../../components/ui/MetricCard";
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
    <Stack gap="md">
      <div className="pipeline-step-page">
        <header className="pipeline-step-header">
          <div>
            <h1>Cost analysis</h1>
            <p className="pipeline-step-description">
              Estimated Azure OpenAI and Document Intelligence spend accumulated for this study.
              Rates are configurable estimates, not Azure invoice amounts.
            </p>
          </div>
          <button type="button" className="secondary" disabled={!studyId.trim() || loading} onClick={() => void load()}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </header>

        {error ? <p className="pipeline-error">{error}</p> : null}

        {!studyId.trim() ? <p className="pipeline-hint">Select a study first.</p> : null}

        {studyId.trim() && loading && !data ? <p>Loading cost usage…</p> : null}

        {data && !data.available ? (
          <Card>
            <p className="pipeline-hint">
              No cost usage recorded yet for this study. Run PDF extraction or LLM pipeline steps to
              populate <code>pipeline/pipeline_cost_usage.json</code>.
            </p>
          </Card>
        ) : null}

        {data?.available ? (
          <Stack gap="md">
            <div className="cost-metrics-grid">
              <MetricCard label="Total estimated cost" value={formatUsd(data.totals.cost_usd)} />
              <MetricCard label="LLM cost" value={formatUsd(llm?.cost_usd)} />
              <MetricCard label="Document Intelligence cost" value={formatUsd(di?.cost_usd)} />
              <MetricCard label="LLM calls" value={formatInt(llm?.calls)} />
              <MetricCard label="Prompt tokens" value={formatInt(llm?.prompt_tokens)} />
              <MetricCard label="Completion tokens" value={formatInt(llm?.completion_tokens)} />
              <MetricCard label="DI pages" value={formatInt(di?.pages)} />
              <MetricCard label="DI calls" value={formatInt(di?.calls)} />
            </div>

            <Card>
              <Stack gap="sm">
                <p>
                  Pricing source: <strong>{data.pricingSource ?? "defaults"}</strong>
                </p>
                <p>
                  Last updated: <strong>{data.updatedAt ?? "—"}</strong>
                </p>
                <p>
                  Recorded events: <strong>{formatInt(data.eventCount)}</strong>
                </p>
                <p className="pipeline-hint">
                  Artifact: <code>{data.artifactPath}</code>
                </p>
              </Stack>
            </Card>

            <Card>
              <h2 className="cost-breakdown-title">By step</h2>
              {rows.length === 0 ? (
                <p className="pipeline-hint">No per-step breakdown yet.</p>
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
            </Card>
          </Stack>
        ) : null}
      </div>
    </Stack>
  );
}

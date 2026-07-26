import type { StepArtifactVersionEntry, StepStatus } from "../../services/stepApi";

interface ArtifactVersionPickerProps {
  stepId: string;
  versions: StepArtifactVersionEntry[];
  activeVersion?: string | null;
  stepStatuses: Record<string, StepStatus>;
  disabled?: boolean;
  onSelect: (version: string) => void;
}

const DOWNSTREAM_WARNINGS: Record<string, string[]> = {
  "extract-rules": ["extract-deviations"],
  "acrf-summary-text": ["extract-rules", "extract-deviations"],
  "extract-deviations": []
};

function formatTimestamp(ts: string): string {
  if (!ts) {
    return "—";
  }
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

function derivedLabel(entry: StepArtifactVersionEntry): string | null {
  const derived = entry.derivedFrom;
  if (!derived?.operation) {
    return null;
  }
  if (derived.operation === "per-rule-dedup" && derived.version) {
    return `dedup of ${derived.version}`;
  }
  if (derived.version) {
    return `${derived.operation} from ${derived.version}`;
  }
  return derived.operation;
}

export function ArtifactVersionPicker({
  stepId,
  versions,
  activeVersion,
  stepStatuses,
  disabled = false,
  onSelect
}: ArtifactVersionPickerProps): JSX.Element | null {
  if (versions.length === 0) {
    return null;
  }

  const latestVersion = versions[versions.length - 1]?.version;
  const downstreamSteps = DOWNSTREAM_WARNINGS[stepId] ?? [];
  const downstreamDone = downstreamSteps.some((id) => stepStatuses[id] === "done");

  return (
    <section className="artifact-version-picker" aria-label="Artifact version selection">
      <h3 className="artifact-version-picker-title">Artifact versions</h3>
      <p className="artifact-version-picker-hint">
        Choose which version downstream steps use. Active:{" "}
        <strong>{activeVersion || latestVersion || "—"}</strong>
      </p>
      <ul className="artifact-version-list">
        {versions.map((entry) => {
          const isActive = entry.version === activeVersion || (entry.active ?? false);
          const isOlder = latestVersion && entry.version !== latestVersion;
          const derived = derivedLabel(entry);
          return (
            <li key={entry.version} className="artifact-version-item">
              <label className="artifact-version-label">
                <input
                  type="radio"
                  name={`artifact-version-${stepId}`}
                  value={entry.version}
                  checked={isActive}
                  disabled={disabled}
                  onChange={() => onSelect(entry.version)}
                />
                <span className="artifact-version-name">{entry.version}</span>
                {isActive ? <span className="artifact-version-badge">Active</span> : null}
                {derived ? <span className="artifact-version-badge artifact-version-badge-derived">{derived}</span> : null}
              </label>
              <div className="artifact-version-meta">
                <span>Created {formatTimestamp(entry.created_at)}</span>
                {entry.generated_at ? (
                  <span>Generated {formatTimestamp(entry.generated_at)}</span>
                ) : null}
                {entry.itemCount > 0 ? <span>{entry.itemCount} items</span> : null}
                {entry.sourceSummary ? <span>{entry.sourceSummary}</span> : null}
              </div>
              {isOlder && downstreamDone && isActive ? (
                <p className="artifact-version-warning">
                  Downstream steps may have been run with a newer version of this artifact.
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

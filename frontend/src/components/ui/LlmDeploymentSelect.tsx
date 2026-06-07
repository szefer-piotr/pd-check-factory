import type { OpenAiDeploymentOption } from "../../services/stepApi";

interface LlmDeploymentSelectProps {
  id: string;
  label: string;
  value: string;
  deployments: OpenAiDeploymentOption[];
  onChange: (value: string) => void;
  isLoading?: boolean;
  disabled?: boolean;
}

export function LlmDeploymentSelect({
  id,
  label,
  value,
  deployments,
  onChange,
  isLoading = false,
  disabled = false
}: LlmDeploymentSelectProps): JSX.Element {
  return (
    <label className="control-group" htmlFor={id}>
      <span className="control-label">{label}</span>
      <select
        id={id}
        className="select"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled || isLoading || deployments.length === 0}
      >
        {deployments.length === 0 ? (
          <option value="">{isLoading ? "Loading models…" : "No models available"}</option>
        ) : (
          deployments.map((deployment) => (
            <option key={deployment.id} value={deployment.id}>
              {deployment.modelName && deployment.modelName !== deployment.id
                ? `${deployment.id} (${deployment.modelName})`
                : deployment.id}
            </option>
          ))
        )}
      </select>
    </label>
  );
}

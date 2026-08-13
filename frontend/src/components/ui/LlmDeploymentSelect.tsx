import { useEffect, useMemo, useRef, useState } from "react";
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

function deploymentLabel(deployment: OpenAiDeploymentOption): string {
  if (deployment.modelName && deployment.modelName !== deployment.id) {
    return `${deployment.id} (${deployment.modelName})`;
  }
  return deployment.id;
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
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const selected = deployments.find((deployment) => deployment.id === value) ?? null;
  const chipLabel = selected
    ? deploymentLabel(selected)
    : isLoading
      ? "Loading models…"
      : deployments.length === 0
        ? "No models available"
        : "Select model";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return deployments;
    }
    return deployments.filter((deployment) => {
      const haystack = `${deployment.id} ${deployment.modelName || ""}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [deployments, query]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setHighlight(0);
    const timer = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(event: MouseEvent): void {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const controlDisabled = disabled || isLoading || deployments.length === 0;

  return (
    <div className="model-chip-field" ref={rootRef}>
      <span className="control-label" id={`${id}-label`}>
        {label}
      </span>
      <div className="model-chip-wrap">
        <button
          type="button"
          id={id}
          className={`model-chip ${open ? "is-open" : ""}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-labelledby={`${id}-label`}
          disabled={controlDisabled}
          onClick={() => setOpen((previous) => !previous)}
        >
          <span className="model-chip-text">{chipLabel}</span>
          <span className="model-chip-caret" aria-hidden="true">
            ▾
          </span>
        </button>
        {open ? (
          <div className="model-chip-popover" role="listbox" aria-labelledby={`${id}-label`}>
            <input
              ref={searchRef}
              className="model-chip-search"
              value={query}
              placeholder="Search models…"
              aria-label={`Search ${label}`}
              onChange={(event) => {
                setQuery(event.target.value);
                setHighlight(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setHighlight((previous) => Math.min(previous + 1, Math.max(filtered.length - 1, 0)));
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setHighlight((previous) => Math.max(previous - 1, 0));
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  const choice = filtered[highlight];
                  if (choice) {
                    onChange(choice.id);
                    setOpen(false);
                    setQuery("");
                  }
                }
              }}
            />
            <ul className="model-chip-options">
              {filtered.length === 0 ? (
                <li className="model-chip-empty">No matches</li>
              ) : (
                filtered.map((deployment, index) => (
                  <li key={deployment.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={deployment.id === value}
                      className={`model-chip-option ${deployment.id === value ? "is-selected" : ""} ${
                        index === highlight ? "is-highlight" : ""
                      }`}
                      onMouseEnter={() => setHighlight(index)}
                      onClick={() => {
                        onChange(deployment.id);
                        setOpen(false);
                        setQuery("");
                      }}
                    >
                      {deploymentLabel(deployment)}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}

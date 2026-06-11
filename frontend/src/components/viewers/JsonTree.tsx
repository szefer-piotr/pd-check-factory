import { useState } from "react";

interface JsonTreeNodeProps {
  name?: string;
  value: unknown;
  depth: number;
  /** Nodes up to this depth start expanded. */
  defaultExpandDepth: number;
}

function previewOf(value: unknown): string {
  if (Array.isArray(value)) {
    return `Array(${value.length})`;
  }
  if (value !== null && typeof value === "object") {
    return `Object(${Object.keys(value as Record<string, unknown>).length})`;
  }
  return "";
}

function JsonTreeNode({ name, value, depth, defaultExpandDepth }: JsonTreeNodeProps): JSX.Element {
  const isComposite = value !== null && typeof value === "object";
  const [expanded, setExpanded] = useState(depth < defaultExpandDepth);

  const label = name !== undefined ? <span className="json-tree-key">{name}: </span> : null;

  if (!isComposite) {
    const display = typeof value === "string" ? `"${value}"` : String(value);
    return (
      <div className="json-tree-row" style={{ paddingLeft: depth * 14 }}>
        {label}
        <span className={`json-tree-value json-tree-value-${value === null ? "null" : typeof value}`}>{display}</span>
      </div>
    );
  }

  const entries: Array<[string | undefined, unknown]> = Array.isArray(value)
    ? value.map((item, index) => [String(index), item])
    : Object.entries(value as Record<string, unknown>);

  return (
    <div>
      <div className="json-tree-row json-tree-row-composite" style={{ paddingLeft: depth * 14 }}>
        <button
          type="button"
          className="json-tree-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((previous) => !previous)}
        >
          {expanded ? "▾" : "▸"}
        </button>
        {label}
        <span className="json-tree-preview">{previewOf(value)}</span>
      </div>
      {expanded
        ? entries.map(([key, item]) => (
            <JsonTreeNode key={key} name={key} value={item} depth={depth + 1} defaultExpandDepth={defaultExpandDepth} />
          ))
        : null}
    </div>
  );
}

interface JsonTreeProps {
  data: unknown;
  defaultExpandDepth?: number;
}

/** Collapsible JSON tree (no external deps). */
export function JsonTree({ data, defaultExpandDepth = 2 }: JsonTreeProps): JSX.Element {
  return (
    <div className="json-tree" role="tree">
      <JsonTreeNode value={data} depth={0} defaultExpandDepth={defaultExpandDepth} />
    </div>
  );
}

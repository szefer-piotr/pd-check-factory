import type { DeviationStatus } from "../../types/study";

interface StatusFilterProps {
  value: DeviationStatus | "all";
  onChange: (next: DeviationStatus | "all") => void;
}

const OPTIONS: Array<{ value: DeviationStatus | "all"; label: string }> = [
  { value: "all", label: "All statuses" },
  { value: "accepted", label: "Accepted" },
  { value: "to_review", label: "To review" },
  { value: "rejected", label: "Rejected" }
];

export function StatusFilter({ value, onChange }: StatusFilterProps): JSX.Element {
  return (
    <label className="control-group" htmlFor="status-filter-select">
      <span className="control-label">Status</span>
      <select
        id="status-filter-select"
        className="select"
        value={value}
        onChange={(event) => onChange(event.target.value as DeviationStatus | "all")}
      >
        {OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

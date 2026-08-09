import type {
  DeviationCommentFilter,
  DeviationProgrammabilityFilter,
  DeviationPseudoFilter,
  DeviationReviewFilters,
  DeviationStatusFilter
} from "./deviationFilters";
import { EMPTY_DEVIATION_REVIEW_FILTERS, deviationFiltersAreActive } from "./deviationFilters";

interface Step7DeviationFiltersProps {
  filters: DeviationReviewFilters;
  filteredCount: number;
  totalCount: number;
  onChange: (next: DeviationReviewFilters) => void;
}

export function Step7DeviationFilters({
  filters,
  filteredCount,
  totalCount,
  onChange
}: Step7DeviationFiltersProps): JSX.Element {
  const active = deviationFiltersAreActive(filters);

  return (
    <div className="step7-filters" aria-label="Deviation filters">
      <label className="step7-filter-field" htmlFor="step7-filter-status">
        <span className="step7-filter-label">Status</span>
        <select
          id="step7-filter-status"
          className="select"
          value={filters.status}
          onChange={(event) =>
            onChange({ ...filters, status: event.target.value as DeviationStatusFilter })
          }
        >
          <option value="all">All</option>
          <option value="pending">Pending</option>
          <option value="to_review">To review</option>
          <option value="accepted">Accepted</option>
          <option value="rejected">Rejected</option>
        </select>
      </label>

      <label className="step7-filter-field" htmlFor="step7-filter-programmability">
        <span className="step7-filter-label">Programmability</span>
        <select
          id="step7-filter-programmability"
          className="select"
          value={filters.programmability}
          onChange={(event) =>
            onChange({
              ...filters,
              programmability: event.target.value as DeviationProgrammabilityFilter
            })
          }
        >
          <option value="all">All</option>
          <option value="Programmable">Programmable</option>
          <option value="Partially programmable">Partially programmable</option>
          <option value="Manual">Manual</option>
          <option value="unset">Unset</option>
        </select>
      </label>

      <label className="step7-filter-field" htmlFor="step7-filter-pseudo">
        <span className="step7-filter-label">Pseudo logic</span>
        <select
          id="step7-filter-pseudo"
          className="select"
          value={filters.pseudo}
          onChange={(event) =>
            onChange({ ...filters, pseudo: event.target.value as DeviationPseudoFilter })
          }
        >
          <option value="all">All</option>
          <option value="has">Has pseudo</option>
          <option value="missing">Missing pseudo</option>
        </select>
      </label>

      <label className="step7-filter-field" htmlFor="step7-filter-comment">
        <span className="step7-filter-label">DM comment</span>
        <select
          id="step7-filter-comment"
          className="select"
          value={filters.comment}
          onChange={(event) =>
            onChange({ ...filters, comment: event.target.value as DeviationCommentFilter })
          }
        >
          <option value="all">All</option>
          <option value="has">Has comment</option>
          <option value="missing">No comment</option>
        </select>
      </label>

      <label className="step7-filter-field step7-filter-field-search" htmlFor="step7-filter-search">
        <span className="step7-filter-label">Search</span>
        <input
          id="step7-filter-search"
          className="input"
          type="search"
          value={filters.search}
          placeholder="ID, rule, text, category…"
          onChange={(event) => onChange({ ...filters, search: event.target.value })}
        />
      </label>

      <div className="step7-filter-meta">
        <span className="step7-muted" aria-live="polite">
          Showing <strong>{filteredCount}</strong> of <strong>{totalCount}</strong>
        </span>
        {active ? (
          <button
            type="button"
            className="button button-ghost"
            onClick={() => onChange(EMPTY_DEVIATION_REVIEW_FILTERS)}
          >
            Clear filters
          </button>
        ) : null}
      </div>
    </div>
  );
}

import type { Step7DeviationRow } from "../../services/stepApi";

export type DeviationStatusFilter = "all" | Step7DeviationRow["status"];

export type DeviationProgrammabilityFilter =
  | "all"
  | "Programmable"
  | "Partially programmable"
  | "Manual"
  | "unset";

export type DeviationPseudoFilter = "all" | "has" | "missing";

export type DeviationCommentFilter = "all" | "has" | "missing";

export interface DeviationReviewFilters {
  status: DeviationStatusFilter;
  programmability: DeviationProgrammabilityFilter;
  pseudo: DeviationPseudoFilter;
  comment: DeviationCommentFilter;
  search: string;
}

export const EMPTY_DEVIATION_REVIEW_FILTERS: DeviationReviewFilters = {
  status: "all",
  programmability: "all",
  pseudo: "all",
  comment: "all",
  search: ""
};

function programmabilityValue(
  row: Step7DeviationRow
): "Programmable" | "Partially programmable" | "Manual" | "unset" {
  const label = row.manual_or_programmable;
  if (label === "Programmable" || label === "Partially programmable" || label === "Manual") {
    return label;
  }
  if (row.programmable === true) {
    return "Programmable";
  }
  if (row.programmable === false) {
    return "Manual";
  }
  return "unset";
}

function matchesSearch(row: Step7DeviationRow, rawQuery: string): boolean {
  const query = rawQuery.trim().toLowerCase();
  if (!query) {
    return true;
  }
  const haystack = [
    row.deviation_id,
    row.rule_id,
    row.rule_title,
    row.deviation_text,
    row.protocol_deviation_category ?? "",
    row.protocol_deviation_sub_category ?? "",
    row.dm_comment
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

export function filterDeviationRows(
  rows: Step7DeviationRow[],
  filters: DeviationReviewFilters
): Step7DeviationRow[] {
  return rows.filter((row) => {
    if (filters.status !== "all" && row.status !== filters.status) {
      return false;
    }
    if (filters.programmability !== "all" && programmabilityValue(row) !== filters.programmability) {
      return false;
    }
    const hasPseudo = Boolean(row.pseudo_logic?.trim());
    if (filters.pseudo === "has" && !hasPseudo) {
      return false;
    }
    if (filters.pseudo === "missing" && hasPseudo) {
      return false;
    }
    const hasComment = Boolean(row.dm_comment?.trim());
    if (filters.comment === "has" && !hasComment) {
      return false;
    }
    if (filters.comment === "missing" && hasComment) {
      return false;
    }
    return matchesSearch(row, filters.search);
  });
}

export function deviationFiltersAreActive(filters: DeviationReviewFilters): boolean {
  return (
    filters.status !== "all" ||
    filters.programmability !== "all" ||
    filters.pseudo !== "all" ||
    filters.comment !== "all" ||
    Boolean(filters.search.trim())
  );
}

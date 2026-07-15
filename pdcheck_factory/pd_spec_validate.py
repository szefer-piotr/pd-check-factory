"""Validate generated PD specification artifacts against NAL00-107 rules."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Mapping, Sequence

from pdcheck_factory.pd_spec_export import PD_SPEC_HEADERS, map_deviation_to_pd_spec_row
from pdcheck_factory.pd_taxonomy import (
    VISIT_WINDOW_SUB_CATEGORIES,
    programming_status_options,
    validate_category,
    validate_sub_category,
)

_BLANK_ONLY_COLUMNS = {
    "Protocol Deviation Occurrence Date",
    "Additional Information / Comments",
    "Programmer Comments",
    "Reviewer Comments",
    "Programmer Check Number",
}

_TRUNCATION_RE = re.compile(r"\.\.\.$")


@dataclass
class ValidationIssue:
    level: str
    code: str
    message: str
    deviation_id: str = ""


@dataclass
class ValidationReport:
    errors: List[ValidationIssue] = field(default_factory=list)
    warnings: List[ValidationIssue] = field(default_factory=list)
    info: List[ValidationIssue] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors

    def to_dict(self) -> Dict[str, Any]:
        def _items(items: Sequence[ValidationIssue]) -> List[Dict[str, str]]:
            return [
                {
                    "level": item.level,
                    "code": item.code,
                    "message": item.message,
                    "deviation_id": item.deviation_id,
                }
                for item in items
            ]

        return {
            "ok": self.ok,
            "error_count": len(self.errors),
            "warning_count": len(self.warnings),
            "info_count": len(self.info),
            "errors": _items(self.errors),
            "warnings": _items(self.warnings),
            "info": _items(self.info),
        }


def _visit_windows_in_protocol(paragraph_index: Mapping[str, Any]) -> bool:
    window_re = re.compile(r"\b(window|day\s*\d|±|\+/-|visit schedule)\b", re.I)
    for paragraph in paragraph_index.get("paragraphs", []):
        text = str(paragraph.get("text", ""))
        if window_re.search(text):
            return True
    return False


def validate_final_deviations(
    final_obj: Mapping[str, Any],
    *,
    paragraph_index: Mapping[str, Any] | None = None,
) -> ValidationReport:
    report = ValidationReport()
    items = list(final_obj.get("items", []))
    status_options = set(programming_status_options())

    if paragraph_index and _visit_windows_in_protocol(paragraph_index):
        has_visit_window = False
        for item in items:
            sub = str(item.get("protocol_deviation_sub_category", "") or "").strip()
            if sub in VISIT_WINDOW_SUB_CATEGORIES:
                has_visit_window = True
                break
        if not has_visit_window:
            report.warnings.append(
                ValidationIssue(
                    level="warning",
                    code="visit_window_coverage",
                    message="Protocol appears to contain visit windows but no visit-window sub-category deviations were found.",
                )
            )

    for item in items:
        dev_id = str(item.get("deviation_id", "") or "")
        category = str(item.get("protocol_deviation_category", "") or "").strip()
        sub_category = str(item.get("protocol_deviation_sub_category", "") or "").strip()
        description = str(item.get("deviation_text", "") or "").strip()
        programming_status = str(item.get("programming_status", "") or "").strip()

        if not description:
            report.errors.append(
                ValidationIssue(
                    level="error",
                    code="empty_description",
                    message="Description is required.",
                    deviation_id=dev_id,
                )
            )
        if _TRUNCATION_RE.search(description):
            report.errors.append(
                ValidationIssue(
                    level="error",
                    code="truncated_description",
                    message="Description appears truncated with '...'.",
                    deviation_id=dev_id,
                )
            )
        if len(description) > 250:
            report.warnings.append(
                ValidationIssue(
                    level="warning",
                    code="description_length_soft",
                    message=f"Description length {len(description)} exceeds soft 250-character target.",
                    deviation_id=dev_id,
                )
            )
        if len(description) > 300:
            report.info.append(
                ValidationIssue(
                    level="info",
                    code="description_length_long",
                    message=f"Description length {len(description)} is unusually long.",
                    deviation_id=dev_id,
                )
            )

        if category and not validate_category(category):
            report.errors.append(
                ValidationIssue(
                    level="error",
                    code="invalid_category",
                    message=f"Invalid category: {category!r}",
                    deviation_id=dev_id,
                )
            )
        if sub_category and not validate_sub_category(category, sub_category):
            report.errors.append(
                ValidationIssue(
                    level="error",
                    code="invalid_sub_category",
                    message=f"Invalid sub-category {sub_category!r} for category {category!r}",
                    deviation_id=dev_id,
                )
            )
        if (category and not sub_category) or (sub_category and not category):
            report.warnings.append(
                ValidationIssue(
                    level="warning",
                    code="incomplete_category_pair",
                    message="Category and sub-category should both be set or both blank.",
                    deviation_id=dev_id,
                )
            )
        if programming_status and programming_status not in status_options:
            report.errors.append(
                ValidationIssue(
                    level="error",
                    code="invalid_programming_status",
                    message=f"Invalid programming status: {programming_status!r}",
                    deviation_id=dev_id,
                )
            )

        manual_or_programmable = str(item.get("manual_or_programmable", "") or "").strip()
        pseudo_logic = item.get("pseudo_logic")
        if manual_or_programmable == "Manual" and pseudo_logic not in (None, ""):
            report.errors.append(
                ValidationIssue(
                    level="error",
                    code="manual_with_logic",
                    message="Manual check must not include programming logic.",
                    deviation_id=dev_id,
                )
            )
        if manual_or_programmable in {"Programmable", "Partially programmable"} and not str(
            pseudo_logic or ""
        ).strip():
            report.errors.append(
                ValidationIssue(
                    level="error",
                    code="programmable_without_logic",
                    message="Programmable check is missing pseudo_logic.",
                    deviation_id=dev_id,
                )
            )

        row = map_deviation_to_pd_spec_row(item)
        header_by_index = {idx: header for idx, header in enumerate(PD_SPEC_HEADERS)}
        for idx, header in header_by_index.items():
            if header not in _BLANK_ONLY_COLUMNS:
                continue
            if idx < len(row) and str(row[idx]).strip():
                report.errors.append(
                    ValidationIssue(
                        level="error",
                        code="blank_column_populated",
                        message=f"Column {header!r} must be blank in export.",
                        deviation_id=dev_id,
                    )
                )

    if "AA comment" in PD_SPEC_HEADERS:
        report.errors.append(
            ValidationIssue(
                level="error",
                code="forbidden_column",
                message="Export headers must not include AA comment.",
            )
        )
    if "Programmer Check Number" not in PD_SPEC_HEADERS:
        report.errors.append(
            ValidationIssue(
                level="error",
                code="missing_column",
                message="Export headers must include Programmer Check Number.",
            )
        )

    return report


def ready_for_review(final_obj: Mapping[str, Any], **kwargs: Any) -> ValidationReport:
    return validate_final_deviations(final_obj, **kwargs)

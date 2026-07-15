"""Unified deterministic validation for generated checks."""

from __future__ import annotations

from typing import Any, Dict, List, Mapping, Sequence

from pdcheck_factory.check_field_validate import validate_field_references
from pdcheck_factory.pd_spec_validate import ValidationIssue, ValidationReport, validate_final_deviations


def validate_check_artifacts(
    *,
    deviations_obj: Mapping[str, Any],
    rules_obj: Mapping[str, Any] | None = None,
    pseudo_obj: Mapping[str, Any] | None = None,
    dictionary_obj: Mapping[str, Any] | None = None,
    final_obj: Mapping[str, Any] | None = None,
    paragraph_index: Mapping[str, Any] | None = None,
) -> ValidationReport:
    report = ValidationReport()
    deviations = list(deviations_obj.get("deviations", []))
    pseudo_items = list((pseudo_obj or {}).get("items", []))
    pseudo_by_dev = {str(item.get("deviation_id", "")): item for item in pseudo_items}

    seen_dev_ids: set[str] = set()
    for deviation in deviations:
        dev_id = str(deviation.get("deviation_id", ""))
        if dev_id in seen_dev_ids:
            report.errors.append(
                ValidationIssue(
                    level="error",
                    code="duplicate_deviation_id",
                    message=f"Duplicate deviation_id: {dev_id}",
                    deviation_id=dev_id,
                )
            )
        seen_dev_ids.add(dev_id)
        refs = list(deviation.get("paragraph_refs", []))
        if not refs:
            report.errors.append(
                ValidationIssue(
                    level="error",
                    code="missing_protocol_citation",
                    message="Deviation is missing paragraph_refs.",
                    deviation_id=dev_id,
                )
            )

    if rules_obj is not None:
        seen_rule_ids: set[str] = set()
        for rule in rules_obj.get("rules", []):
            rule_id = str(rule.get("rule_id", ""))
            if rule_id in seen_rule_ids:
                report.errors.append(
                    ValidationIssue(
                        level="error",
                        code="duplicate_rule_id",
                        message=f"Duplicate rule_id: {rule_id}",
                    )
                )
            seen_rule_ids.add(rule_id)

    for item in pseudo_items:
        dev_id = str(item.get("deviation_id", ""))
        manual_or_programmable = str(item.get("manual_or_programmable", "")).strip()
        pseudo_logic = item.get("pseudo_logic")
        if manual_or_programmable == "Manual" and pseudo_logic not in (None, ""):
            report.errors.append(
                ValidationIssue(
                    level="error",
                    code="manual_with_logic",
                    message="Manual check must not have programming logic.",
                    deviation_id=dev_id,
                )
            )
        if manual_or_programmable in {"Programmable", "Partially programmable"} and not str(pseudo_logic or "").strip():
            report.errors.append(
                ValidationIssue(
                    level="error",
                    code="programmable_without_logic",
                    message="Programmable check is missing pseudo_logic.",
                    deviation_id=dev_id,
                )
            )
        if dictionary_obj is not None:
            field_result = validate_field_references(
                dictionary_obj=dictionary_obj,
                pseudo_logic=str(item.get("pseudo_logic") or ""),
                data_support_note=str(item.get("data_support_note") or ""),
                required_fields=list(item.get("required_data", []) or []),
            )
            if field_result["needs_mapping_review"]:
                report.warnings.append(
                    ValidationIssue(
                        level="warning",
                        code="unknown_acrf_field",
                        message="Check references unknown ACRF fields.",
                        deviation_id=dev_id,
                    )
                )

    for deviation in deviations:
        dev_id = str(deviation.get("deviation_id", ""))
        pseudo = pseudo_by_dev.get(dev_id, {})
        if dictionary_obj is not None:
            field_result = validate_field_references(
                dictionary_obj=dictionary_obj,
                pseudo_logic=str(pseudo.get("pseudo_logic") or ""),
                data_support_note=str(deviation.get("data_support_note") or ""),
            )
            if field_result["needs_mapping_review"]:
                report.warnings.append(
                    ValidationIssue(
                        level="warning",
                        code="unknown_acrf_field",
                        message="Deviation references unknown ACRF fields.",
                        deviation_id=dev_id,
                    )
                )

    if final_obj is not None:
        final_report = validate_final_deviations(final_obj, paragraph_index=paragraph_index)
        report.errors.extend(final_report.errors)
        report.warnings.extend(final_report.warnings)
        report.info.extend(final_report.info)

    return report


def count_valid_citations(deviations_obj: Mapping[str, Any]) -> int:
    count = 0
    for deviation in deviations_obj.get("deviations", []):
        if list(deviation.get("paragraph_refs", [])):
            count += 1
    return count

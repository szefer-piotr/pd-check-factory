from __future__ import annotations

import unittest

from pdcheck_factory.prompt_loader import load_prompt


class PromptTemplateTests(unittest.TestCase):
    def test_step2_revalidate_prompt_formats_without_keyerror(self) -> None:
        template = load_prompt("step2_revalidate_deviation_user")
        rendered = template.format(
            study_id="study-x",
            now="2026-04-14T00:00:00+00:00",
            context_mode="full_protocol",
            rule_json="{}",
            deviation_json="{}",
            dm_comments="Please refine wording.",
            protocol_context="Protocol text...",
            acrf_summary_context="{}",
        )
        self.assertIn("deviations:", rendered)

    def test_step2_revalidate_text_prompt_formats_without_keyerror(self) -> None:
        template = load_prompt("step2_revalidate_text_user")
        rendered = template.format(
            study_id="study-x",
            now="2026-04-14T00:00:00+00:00",
            context_mode="full_protocol",
            rule_text="{}",
            deviation_text="{}",
            dm_comments="Please refine wording.",
            protocol_context="Protocol text sec:abc#s1",
            acrf_summary_context="{}",
        )
        self.assertIn("DM comments", rendered)

    def test_acrf_section_summary_prompt_formats_without_keyerror(self) -> None:
        template = load_prompt("acrf_section_summary_user")
        rendered = template.format(
            study_id="study-x",
            now="2026-04-14T00:00:00+00:00",
            acrf_section_id="acrf:001_demo",
            acrf_section_path_json='["Demographics"]',
            section_markdown="# Demographics\n- AGE\n- SEX",
        )
        self.assertIn("acrf_section_id", rendered)

    def test_section_text_rules_user_formats(self) -> None:
        template = load_prompt("section_text_rules_user")
        rendered = template.format(
            study_id="study-x",
            now="2026-04-14T00:00:00+00:00",
            section_id="sec:abc",
            section_path_json='["Intro"]',
            numbered_section="sec:abc#s1: Hello.",
        )
        self.assertIn("sec:abc", rendered)

    def test_deviations_v2_prompt_emphasizes_explicit_constraints(self) -> None:
        system_template = load_prompt("deviations_v2_system")
        self.assertIn("short, check-oriented description", system_template)
        self.assertIn("target about 250 characters", system_template)

        user_template = load_prompt("deviations_v2_user")
        rendered = user_template.format(
            study_id="study-x",
            rule_id="rule-001",
            rule_title="Visit timing",
            rule_text="Visit must happen Day 3-5 after dose.",
            rule_paragraph_refs="p1",
            acrf_summary='{"datasets":[]}',
            protocol_paragraphs="p1: Visit Day 3 to Day 5 after dose.",
            additional_instructions="Focus oncology visits only.",
        )
        self.assertIn("Restate concrete protocol constraints explicitly", rendered)
        self.assertIn("Focus oncology visits only.", rendered)

    def test_rules_v2_user_formats_with_additional_instructions(self) -> None:
        template = load_prompt("rules_v2_user")
        rendered = template.format(
            study_id="study-x",
            now="2026-04-14T00:00:00+00:00",
            protocol_paragraphs="p1: text",
            additional_instructions="Emphasize dosing rules.",
        )
        self.assertIn("Additional instructions", rendered)
        self.assertIn("Emphasize dosing rules.", rendered)

    def test_protocol_enrich_ground_protocol_user_formats(self) -> None:
        template = load_prompt("protocol_enrich_ground_protocol_user")
        rendered = template.format(
            study_id="study-x",
            deviation_id="dev-import-1",
            protocol_deviation_category="Visit",
            protocol_deviation_sub_category="Timing",
            classification="Major",
            deviation_text="Out of window",
            protocol_paragraphs="p1: Visit window Day 3-5",
        )
        self.assertIn("Imported deviation text", rendered)
        self.assertIn("p1: Visit window", rendered)

    def test_protocol_enrich_ground_acrf_user_formats(self) -> None:
        template = load_prompt("protocol_enrich_ground_acrf_user")
        rendered = template.format(
            study_id="study-x",
            deviation_id="dev-import-1",
            protocol_deviation_category="Visit",
            protocol_deviation_sub_category="Timing",
            classification="Major",
            deviation_text="Out of window",
            paragraph_refs="p1",
            protocol_data_support_note="SV dates",
            protocol_supporting_paragraphs="p1: text",
            acrf_summary="{}",
        )
        self.assertIn("Merged aCRF summary", rendered)

    def test_protocol_enrich_propose_user_formats(self) -> None:
        template = load_prompt("protocol_enrich_propose_user")
        rendered = template.format(
            study_id="study-x",
            deviation_id="dev-import-1",
            protocol_deviation_category="Visit",
            protocol_deviation_sub_category="Timing",
            classification="Major",
            original_deviation_text="Out of window",
            protocol_supporting_paragraphs="p1: text",
            pseudo_logic_plain_english="IF visit outside window",
            programmable="yes",
            programmability_risk="low",
            programmability_rationale="SV has dates",
            acrf_sections="SV",
            acrf_data_support_note="Use visit dates",
        )
        self.assertIn("Original imported deviation text", rendered)


if __name__ == "__main__":
    unittest.main()

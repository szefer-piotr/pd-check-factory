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
        )
        self.assertIn("deviations:", rendered)


if __name__ == "__main__":
    unittest.main()

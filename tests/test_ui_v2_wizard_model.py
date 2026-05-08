from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from pdcheck_factory import paths
from pdcheck_factory import ui_v2_wizard_model as wiz


class WizardModelTests(unittest.TestCase):
    def test_parse_import_csv_success(self) -> None:
        csv_body = b"deviation_id,rule_id,text,paragraph_refs\n"
        csv_body += b'd1,RULE1,Hello world,"p1,p3"\n'
        rows, errs = wiz.parse_import_csv(csv_body, set())
        self.assertEqual(errs, [])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["deviation_id"], "d1")
        self.assertEqual(rows[0]["paragraph_refs"], ["p1", "p3"])
        self.assertEqual(rows[0]["entry_source"], "imported")

    def test_parse_import_csv_duplicate(self) -> None:
        csv_body = b"deviation_id,rule_id,text,paragraph_refs\n"
        csv_body += b"d1,RULE1,Hello world,p1\n"
        rows, errs = wiz.parse_import_csv(csv_body, {"d1"})
        self.assertFalse(rows)
        self.assertTrue(any("duplicate" in e for e in errs))

    def test_deviations_all_terminal_empty(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            out = Path(td)
            sid = "S1"
            paths.local_deviations_review_state(sid, out).parent.mkdir(parents=True, exist_ok=True)
            paths.local_deviations_review_state(sid, out).write_text(
                '{"schema_version":"1.0.0","study_id":"S1","generated_at":"2026-01-01T00:00:00Z","deviations":[]}',
                encoding="utf-8",
            )
            self.assertTrue(wiz.deviations_all_terminal(sid, out))

    def test_deviations_all_terminal_mixed_status(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            out = Path(td)
            sid = "S1"
            paths.local_deviations_review_state(sid, out).parent.mkdir(parents=True, exist_ok=True)
            paths.local_deviations_review_state(sid, out).write_text(
                '{"schema_version":"1.0.0","study_id":"S1","generated_at":"2026-01-01T00:00:00Z",'
                '"deviations":[{"deviation_id":"d1","rule_id":"r","text":"t","paragraph_refs":["p1"],'
                '"status":"pending"}]}',
                encoding="utf-8",
            )
            self.assertFalse(wiz.deviations_all_terminal(sid, out))

    def test_compute_step_states_prior_complete(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            mid = root / "mid.json"
            out = root / "out.json"
            mid.write_text("{}", encoding="utf-8")
            steps = [
                wiz.WizardStep("a", 1, "One", "automated_batch", [], [(mid, "file")]),
                wiz.WizardStep(
                    "b",
                    2,
                    "Two",
                    "automated_batch",
                    [(mid, "file")],
                    [(out, "file")],
                ),
            ]
            states = wiz.compute_step_states(steps, workshop_done=False)
            self.assertEqual(states[0]["status"], "complete")
            self.assertEqual(states[1]["status"], "ready")
            self.assertTrue(states[1]["selectable"])

    def test_workshop_step_complete_uses_flag(self) -> None:
        steps = [
            wiz.WizardStep(
                "workshop",
                1,
                "WS",
                "ui_workshop",
                [],
                [(Path("/noop.json"), "file")],
            ),
        ]
        states_off = wiz.compute_step_states(steps, workshop_done=False)
        self.assertEqual(states_off[0]["status"], "ready")
        states_on = wiz.compute_step_states(steps, workshop_done=True)
        self.assertEqual(states_on[0]["status"], "complete")


if __name__ == "__main__":
    unittest.main()

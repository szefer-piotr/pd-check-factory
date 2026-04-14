from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from pdcheck_factory.cli import run_acrf_split_toc


class AcrfSplitTocTests(unittest.TestCase):
    def test_split_toc_writes_section_files_and_manifest(self) -> None:
        source = """# Table Of Contents
<table>
<tr><td>Participant (SUBJ)</td><td>3</td></tr>
<tr><td>Prior and Concomitant Medications (CM)</td><td>114</td></tr>
<tr><td>Procedures YN (PRYN)</td><td>117</td></tr>
</table>
<!-- PageNumber="Page 2 of 216 pages" -->
<!-- PageBreak -->
INI-2004-102
Page: Participant (SUBJ)
SUBJ BODY
<!-- PageNumber="Page 114 of 216 pages" -->
<!-- PageBreak -->
INI-2004-102
CM BODY WITHOUT PAGE HEADER
<!-- PageNumber="Page 117 of 216 pages" -->
<!-- PageBreak -->
INI-2004-102
Page: Procedures YN (PRYN) - Requires Signature
PRYN BODY
"""
        with tempfile.TemporaryDirectory() as td:
            td_path = Path(td)
            src = td_path / "source.md"
            src.write_text(source, encoding="utf-8")
            out_dir = td_path / "sections_toc"

            count, manifest_path = run_acrf_split_toc(
                source_md=src,
                destination_dir=out_dir,
                write_manifest=True,
            )

            self.assertEqual(count, 3)
            self.assertTrue(manifest_path.exists())

            subj = out_dir / "003_subj_participant_subj.md"
            cm = out_dir / "114_cm_prior_and_concomitant_medications_cm.md"
            pryn = out_dir / "117_pryn_procedures_yn_pryn.md"
            self.assertTrue(subj.exists())
            self.assertTrue(cm.exists())
            self.assertTrue(pryn.exists())

            self.assertIn("SUBJ BODY", subj.read_text(encoding="utf-8"))
            self.assertIn("CM BODY WITHOUT PAGE HEADER", cm.read_text(encoding="utf-8"))
            self.assertIn("PRYN BODY", pryn.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()

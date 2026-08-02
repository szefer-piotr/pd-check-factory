from __future__ import annotations

import json
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
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            self.assertEqual(manifest["split_strategy"], "toc")

            subj = out_dir / "003_subj_participant_subj.md"
            cm = out_dir / "114_cm_prior_and_concomitant_medications_cm.md"
            pryn = out_dir / "117_pryn_procedures_yn_pryn.md"
            self.assertTrue(subj.exists())
            self.assertTrue(cm.exists())
            self.assertTrue(pryn.exists())

            self.assertIn("SUBJ BODY", subj.read_text(encoding="utf-8"))
            self.assertIn("CM BODY WITHOUT PAGE HEADER", cm.read_text(encoding="utf-8"))
            self.assertIn("PRYN BODY", pryn.read_text(encoding="utf-8"))

    def test_split_form_inventory_fallback_without_toc(self) -> None:
        source = """# ANNOTATED CASE REPORT FORM

## 1. Form inventory

<table>
<tr>
<th>Form OID</th>
<th>Form name</th>
<th>Collection timing</th>
</tr>
<tr>
<td>IC</td>
<td>Informed Consent</td>
<td>Screening</td>
</tr>
<tr>
<td>DM</td>
<td>Demographics</td>
<td>Screening</td>
</tr>
<tr>
<td>EX</td>
<td>Exposure</td>
<td>Day 1</td>
</tr>
<tr>
<td>AE</td>
<td>Adverse Events</td>
<td>Continuous</td>
</tr>
</table>

## IC - Informed Consent

IC BODY

## DM - Demographics

DM BODY

## Manual-review annotation

Not a form section.

EX - Exposure

EX BODY

## AE - Adverse Events

AE BODY

## 10. Canonical field dictionary

Dictionary noise that must not become a section.
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

            self.assertEqual(count, 4)
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            self.assertEqual(manifest["split_strategy"], "form_inventory")
            self.assertEqual(len(manifest["sections"]), 4)

            ic = out_dir / "001_ic_informed_consent_ic.md"
            dm = out_dir / "002_dm_demographics_dm.md"
            ex = out_dir / "003_ex_exposure_ex.md"
            ae = out_dir / "004_ae_adverse_events_ae.md"
            self.assertTrue(ic.exists())
            self.assertTrue(dm.exists())
            self.assertTrue(ex.exists())
            self.assertTrue(ae.exists())

            ic_text = ic.read_text(encoding="utf-8")
            self.assertIn("IC BODY", ic_text)
            self.assertNotIn("DM BODY", ic_text)

            ex_text = ex.read_text(encoding="utf-8")
            self.assertIn("EX BODY", ex_text)
            self.assertNotIn("AE BODY", ex_text)
            self.assertNotIn("Canonical field dictionary", ex_text)

            # Last form section runs to EOF (same as TOC), so trailing notes may be included.
            ae_text = ae.read_text(encoding="utf-8")
            self.assertIn("AE BODY", ae_text)

            # Non-form headings must not produce section files.
            self.assertEqual(len(list(out_dir.glob("*.md"))), 4)

    def test_form_inventory_ignores_later_field_dictionary_table(self) -> None:
        source = """## 1. Form inventory
<table>
<tr><th>Form OID</th><th>Form name</th><th>Collection timing</th></tr>
<tr><td>IC</td><td>Informed Consent</td><td>Screening</td></tr>
<tr><td>AE</td><td>Adverse Events</td><td>Continuous</td></tr>
</table>

## IC - Informed Consent
IC BODY

## AE - Adverse Events
AE BODY

## 10. Canonical field dictionary
<table>
<tr><th>Form</th><th>Field</th><th>Label</th></tr>
<tr><td>IC</td><td>ICYN</td><td>Consent?</td></tr>
<tr><td>AE</td><td>AETERM</td><td>Term</td></tr>
</table>
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

            self.assertEqual(count, 2)
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            self.assertEqual([s["code"] for s in manifest["sections"]], ["IC", "AE"])


if __name__ == "__main__":
    unittest.main()

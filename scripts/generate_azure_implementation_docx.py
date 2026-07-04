#!/usr/bin/env python3
"""Generate PD Check Factory Azure implementation architecture DOCX."""

from __future__ import annotations

import sys
from pathlib import Path

from markdown_to_docx import TitlePage, convert_markdown_to_docx

REPO_ROOT = Path(__file__).resolve().parent.parent
MD_SOURCE = REPO_ROOT / "docs" / "azure-implementation-v1.md"
DOCX_OUTPUT = REPO_ROOT / "docs" / "PD_Check_Factory_Azure_Implementation_v1.0_draft.docx"


def main() -> int:
    if not MD_SOURCE.is_file():
        print(f"Missing source: {MD_SOURCE}", file=sys.stderr)
        return 1
    convert_markdown_to_docx(
        MD_SOURCE,
        DOCX_OUTPUT,
        title_page=TitlePage(
            title="PD Check Factory",
            subtitle="Azure Implementation Architecture",
        ),
    )
    print(f"Wrote {DOCX_OUTPUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

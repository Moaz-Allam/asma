#!/usr/bin/env python
"""
Convert a .docx in context/docs/ into agent-readable Markdown.

Why this exists: twelve .docx/.xlsx files live in context/docs/, and an agent
cannot read any of them with its file tools. progress-tracker.md §11 opens with
"READ ARCHITECTURE-REVIEW.md FIRST" — a file that only existed as .docx, making
the most emphatic instruction in the project unfollowable. See context/contradictions.md C6.

Convert on demand, not in bulk. Turning all twelve into Markdown would add
~200KB to context/ and recreate the context-rot problem CLAUDE.md exists to fix.

Usage:
    python .claude/tools/docx-to-md.py context/docs/NAME.docx [-o out.md]
"""

import argparse
import re
import sys
import zipfile
from html import unescape
from pathlib import Path

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def paragraphs(xml: str):
    """Yield (style, text) per <w:p>, preserving heading level and list-ness."""
    for block in re.findall(r"<w:p[ >].*?</w:p>|<w:p/>", xml, re.S):
        text = unescape(re.sub(r"<[^>]+>", "", re.sub(r"</w:tab>|<w:tab/>", "\t", block))).strip()
        style = ""
        m = re.search(r'<w:pStyle w:val="([^"]+)"', block)
        if m:
            style = m.group(1)
        is_list = "<w:numPr" in block
        yield style, is_list, text


def to_markdown(docx: Path) -> str:
    with zipfile.ZipFile(docx) as z:
        xml = z.read("word/document.xml").decode("utf-8", "replace")

    out, prev_blank = [], True
    for style, is_list, text in paragraphs(xml):
        if not text:
            if not prev_blank:
                out.append("")
                prev_blank = True
            continue
        prev_blank = False

        # Word smart punctuation renders as mojibake through this path; normalise.
        for bad, good in (("’", "'"), ("‘", "'"), ("“", '"'),
                          ("”", '"'), ("–", "-"), ("—", " - "),
                          ("�", "-")):
            text = text.replace(bad, good)

        heading = re.match(r"Heading(\d)", style)
        if heading:
            out += ["", f"{'#' * min(int(heading.group(1)) + 1, 6)} {text}", ""]
        elif style == "Title":
            out += [f"# {text}", ""]
        elif is_list:
            out.append(f"- {text}")
        else:
            out.append(text)

    md = "\n".join(out)
    md = re.sub(r"\n{3,}", "\n\n", md).strip()
    return md + "\n"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("docx", type=Path)
    ap.add_argument("-o", "--out", type=Path)
    a = ap.parse_args()

    if not a.docx.exists():
        print(f"not found: {a.docx}", file=sys.stderr)
        return 1

    body = to_markdown(a.docx)
    header = (
        f"<!-- Converted from {a.docx.as_posix()} by .claude/tools/docx-to-md.py.\n"
        f"     The .docx remains the human-authored original; edit that, then re-convert.\n"
        f"     Formatting (tables, images, comments) is lost in this direction. -->\n\n"
    )
    dest = a.out or a.docx.with_suffix(".md")
    dest.write_text(header + body, encoding="utf-8")
    print(f"{dest}  ({len(body):,} chars, {body.count(chr(10)) + 1} lines)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

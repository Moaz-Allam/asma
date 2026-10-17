# Product brief

The owner's product brief lives here, **imported verbatim** with numbered sections, so every other
document can cite it as "brief §12". It is precedence level 4: specs and the decision log may override
it, but only explicitly, with a decision log row.

**Status: not imported yet (owner step S12).** The original brief files (`.docx` / `.xlsx`, formerly in
`context/docs/`) are no longer in the repository. Until they are imported, the product sections of
`context/project-overview.md` stand in for the brief.

To import: put the files in this folder, then convert each one on demand with
`python .claude/tools/docx-to-md.py docs/brief/<file>.docx`, keep the text unchanged, and number the
sections. Never edit an imported brief file; record changes as decision log overrides instead.

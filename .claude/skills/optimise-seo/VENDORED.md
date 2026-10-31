# Vendored: optimise-seo

| | |
| --- | --- |
| Source | `mblode/agent-skills`, path `skills/seo/` (spec 0005 names it `optimise-seo`; upstream renamed it, and the frontmatter name is `seo`) |
| Pinned commit | `2294de5` (`2294de53b7b8b6f661000b59fdf672f5fbb1b78a`, 2026-10-29) |
| License | MIT (copy in `LICENSE`) |
| Reviewed | 2026-10-31, every kept file read in full before vendoring |
| Used for | Part 2 of position 01: metadata, sitemap, JSON-LD (spec 0005 AC-29, D103) |

Files are byte for byte copies of the pinned commit (SHA-256):

| File | SHA-256 |
| --- | --- |
| `SKILL.md` | `7b3a5e6f13924122553246acb3f81652f7fedc4b5b8a7ee09a7231a408108d3b` |
| `references/nextjs-implementation.md` | `4552d3026b29a40bf58f5c139e51e22391092abdd620cf745cf270a205b6dac5` |
| `references/metadata-copy.md` | `a9eee56eec56520a61aef3e30bbbe989e3e86e2f19218d118490c37ef433d5b7` |

## Kept

`SKILL.md`, `references/nextjs-implementation.md` (the App Router facts), `references/metadata-copy.md` (house
style for titles and descriptions).

## Left out

`scripts/prompt-panel.py` (needs vendor API keys and runs paid prompts), `evals/`, and the references on
audits, research, briefs, monitoring and AI search (`audit.md`, `research-protocol.md`, `brief-template.md`,
`monitoring.md`, `answer-engines.md`, `sources.md`, `validation-evidence.md`): useful once a domain is live, not
for building the pages. Links to these files from `SKILL.md` will not resolve; expected.

## Overrides (our docs win)

- Spec 0005 wins: AC-29 fixes the markup, AC-30 the indexing switch, AC-27 the copy (the owner approves it).
- `metadata-copy.md`'s "priority pages need owner review" applies to every title and description on the landing
  page.
- Never read another project's env file for keys, and never run a paid tool without the owner.

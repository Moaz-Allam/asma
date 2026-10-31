# Vendored: shadcn

| | |
| --- | --- |
| Source | `shadcn-ui/ui`, path `skills/shadcn/` |
| Pinned commit | `24a1642` (`24a16429815cc4d691f38b49d0f4ffc11a9daef4`, 2026-10-31) |
| License | MIT (copy in `LICENSE`) |
| Reviewed | 2026-10-31, every kept file read in full before vendoring |
| Used for | shadcn/ui in position 01 (spec 0005 AC-18, D103) |

## Changed from the source

Unlike our other vendored skills, these copies are not byte for byte, on purpose:

- `SKILL.md`: the `allowed-tools` line is removed (it would allow `npx shadcn@latest` without asking),
  and so is the `## Current Project Context` block, whose `` !`npx shadcn@latest info --json` `` line
  runs a floating package every time the skill loads.
- `SKILL.md`, `customization.md`, `rules/*.md`: every `shadcn@latest` becomes `shadcn@4.21.5`, the exact
  CLI version (AC-18). Bump it here and in `components.json` work together, after a review.

Hashes of the changed copies (SHA-256):

| File | SHA-256 |
| --- | --- |
| `SKILL.md` | `f54ac40dc4b834a7d229223792fa02d6c51dd99f2d0850c1f73431ab5d203bf9` |
| `customization.md` | `d76e7186e61bd8265c5c6864d6addfd0071d7da881c3dd7cae69dd8802fbd5ea` |
| `rules/base-vs-radix.md` | `06dc3195267b2e503efd69743f487b0095f8bf172d7dc75b90bc57b9cb3cc6bc` |
| `rules/composition.md` | `f282df828d83a91132a846ddb62eea149a7c7c94822e9ca88cfddf85af01aa41` |
| `rules/forms.md` | `29593e14381e34626f8e0e9c15c59f3394b92a0623af6a6ec94585400123853c` |
| `rules/icons.md` | `d4a58266648872d9ee07d0c2368843a1cb88b8253b7f528dd7bda9d68b6c2535` |
| `rules/styling.md` | `f88fbd72dff862805b786dc7d7e4c74c83030fc278c5b97c993e4e665001798c` |

## Left out

`rules/chat.md` (no chat UI). `cli.md`, `registry.md`, `mcp.md`: we use the CLI in two ways only, `init` once
and `add` per component, and no third party registry. `design-system.md`, `design-system-page.md`, `assets/`,
`scripts/`, `evals/`, `agents/`: for building a design system with shadcn; ours is `context/ui-tokens.md`.
Links to these files from `SKILL.md` will not resolve; expected.

## Overrides (our docs win)

- `context/ui-tokens.md` and `context/ui-rules.md` win over every styling rule here. Our token names replace
  shadcn's; there is no dark mode (D50), so ignore the `dark:` and `next-themes` text.
- Base is **Radix** (spec 0005 task 6 pins Radix packages). Read the radix half of `base-vs-radix.md`.
- Physical classes in copied components become logical ones (AC-18, `npm run lint:rtl`).
- `Field`, `Empty`, `Spinner` and the like are used only if position 01 lists them; every new component gets a
  `context/ui-registry.md` row.
- Community registries stay off. Never run `add --overwrite` or a preset command without the owner.

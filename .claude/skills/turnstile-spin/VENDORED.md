# Vendored: Turnstile Next.js App Router reference

| | |
| --- | --- |
| Source | `cloudflare/skills`, path `skills/turnstile-spin/references/nextjs-app.md` |
| Pinned commit | `86505e4` (2026-10-15) |
| License | Apache-2.0 (copy in `LICENSE`) |
| Reviewed | 2026-10-17, line by line, before vendoring |
| Used for | The bot check before OTP send and request posting (approved 2026-10-17) |

This folder deliberately has **no `SKILL.md`**: it is one reference file, read on demand by the spec and
build that add Turnstile. It never loads by itself.

## Left out

The `turnstile-spin` skill itself (`SKILL.md`, a wizard that creates widgets and handles the secret),
its shell scripts (`auth-probe.sh`, `widget-create.sh`, `validate.sh`, `persist-skill.sh`), tests, and
the other framework references.

## Project overrides (these win over the reference)

- The owner creates the widget in the Cloudflare dashboard (owner step). The site key and secret go
  straight into hosting and local env files; they never enter the session.
- No `process.env.X!` non null assertions: the secret and allowed hostnames are validated in
  `lib/env.ts` like every other variable, and read only inside the Turnstile single door.
- `x-forwarded-for` can hold several addresses; take the client address the hosting platform documents,
  never the raw header.
- The bot check runs **before** the rate limit, so bots never write to the limit table
  (`docs/engineering-approach.md` §14.6).

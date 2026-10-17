# Vendored: resend

| | |
| --- | --- |
| Source | `resend/resend-skills`, path `skills/resend/` |
| Pinned commit | `247779a` (2026-10-16) |
| License | MIT (copy in `LICENSE`) |
| Reviewed | 2026-10-17, line by line, before vendoring |
| Used for | Transactional email: sending, idempotency keys, error codes, domain DNS, API key scoping |

## Kept

`SKILL.md`, `references/sending/overview.md`, `references/sending/best-practices.md`,
`references/sending/single-email-examples.md`, `references/domains.md`, `references/api-keys.md`.

## Left out

Every other reference: automations, broadcasts, contacts, contact properties, segments, topics, events,
inboxes, receiving, templates, logs, usage, batch examples, email management, webhooks, installation,
and the `fetch-all-templates.mjs` script. Links to them inside `SKILL.md` will not resolve; that is
expected. Add one only through the tooling gap scan (ask first).

## Project overrides (these win over the skill)

- **No SDK.** "Always install the latest SDK version" does not apply. Email goes through the REST API
  with `fetch`, from one single door module (`lib/email/`), as decided when the notifications position
  is specced. Every dependency is pinned exactly and recorded in `AGENTS.md`.
- **Never run installers or setup commands** the references mention (`npx skills add …`,
  `email resend setup`). Ask the owner instead.
- **Never create, update, or delete Resend resources** (domains, API keys, webhooks) through the API.
  Those are owner steps in the dashboard (`context/progress-tracker.md`, owner checklist).
- Idempotency keys come from domain ids, for example `request-chosen/<request_id>`, matching rule 6.
- Emails carry references and links, never customer personal data beyond what the recipient may see
  (rule 2, `context/i18n.md` for locale and direction).

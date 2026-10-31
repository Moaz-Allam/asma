# Vendored: posthog-nextjs-app-router

| | |
| --- | --- |
| Source | `PostHog/skills`, path `skills/posthog/integration/skills/nextjs-app-router/` |
| Pinned commit | `1914a60` (`1914a60317cbb8ed7e84544f3f5dce79256eb6bd`, 2026-10-27; skill version 1.9.4) |
| License | MIT (copy in `LICENSE`) |
| Reviewed | 2026-10-28, every file read in full before vendoring; the owner reviews this copy line by line before it is committed |
| Used for | `lib/analytics/`, the PostHog door of position 00b (spec 0004, AC-6, AC-7, AC-19; D68, D73) |

Files are byte for byte copies of the pinned commit (SHA-256):

| File | SHA-256 |
| --- | --- |
| `SKILL.md` | `44bf3f61ace775c68571b3169bb1e5c299faf66e18fc4fb154e874a02e396f19` |
| `references/next-js.md` | `122f0d330daed7a074de5f40f7425c239ccb0398784e5b0c6002ebe7017e1df4` |
| `references/EXAMPLE.md` | `76df5558f0f93e86d1ad6766dff0e3807d20674396f800a96ab9173030692618` |

## Kept

`SKILL.md`, `references/next-js.md` (init in `instrumentation-client.ts`, the reverse proxy),
`references/EXAMPLE.md` (the example project: rewrites and `skipTrailingSlashRedirect`).

## Left out

`references/identify-users.md` (we never identify anyone, D68). `references/basic-integration-1.0-begin.md`
to `references/basic-integration-1.3-conclude.md`: the wizard workflow. It writes
`.posthog-events.json`, requires server side events, adds `identify()` and exception capture, creates a
dashboard through the PostHog MCP, and writes `posthog-setup-report.md`. Every one of those contradicts
spec 0004. The links to these files from `SKILL.md` will not resolve; expected.

## Project overrides (spec 0004 wins over the skill)

- **No wizard.** Never run `npx @posthog/wizard`. The 2026-10-27 wizard run was set aside (D73).
- **One door.** Only `lib/analytics/` imports `posthog-*` (AC-8, lint enforced). Components call
  `track()`; `instrumentation-client.ts` calls `initAnalytics()`. Never import `posthog-js` elsewhere.
- **The key is `NEXT_PUBLIC_POSTHOG_KEY`.** Not the skill's `NEXT_PUBLIC_POSTHOG_TOKEN` or
  `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN`. There is no host variable: `api_host` is the constant `/api/a` and
  `ui_host` is `https://eu.posthog.com` (EU Cloud, D62).
- **Cookieless and anonymous.** `cookieless_mode: 'always'`, `person_profiles: 'never'`, nothing written
  to cookies, `localStorage` or `sessionStorage`. Never call `identify()`, `alias()` or `reset()`, and
  never send a person property.
- **Every option explicit, no `defaults` date.** Autocapture, pageleave, heatmaps, dead clicks,
  exception capture (`capture_exceptions: false`; errors go to Sentry), session recording, surveys and
  remote feature flags are off. Pageviews are sent manually, one per route change, with scrubbed URLs.
- **Allow listed events only.** The `AnalyticsEvent` union types every event; `before_send` drops any
  other name, including SDK generated ones. 00b defines `$pageview` and `locale_changed`.
- **Server side analytics waits.** `posthog-node` arrives with the first server event (position 08
  or 09), not before. The skill's "server side events are REQUIRED" does not apply.
- **The proxy uses the EU hosts:** `/api/a/static/*` and `/api/a/array/*` to
  `https://eu-assets.i.posthog.com`, the rest to `https://eu.i.posthog.com`.
- **Pinned version.** `posthog-js` 1.418.11 (owner choice 2026-10-28), exact, recorded in `AGENTS.md`;
  never `@latest`.

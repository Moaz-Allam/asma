# Setup — the steps only a human can do

Everything in this file requires an account, a credential, a payment method, or a browser console.
The agent cannot do any of it, and several items **block** work it would otherwise start.

Order matters: §1 unblocks Phase 0, §2 unblocks Phase 2, §3 unblocks Phase 4–5.
Record every answer in `context/progress-tracker.md` — if it is not written there, the next session
does not know it.

---

## 0. Already done (no action)

| | |
| --- | --- |
| Agent rules and routing | `CLAUDE.md`, `AGENTS.md` |
| Write-time guardrails | `.claude/hooks/guard.mjs` — 19 rules, 39-case regression suite |
| Session state injection | `.claude/hooks/session-context.mjs` |
| Workflow skills | `/architect` `/review` `/recover` `/remember` `/imprint` |
| Vendor skills | `supabase`, `supabase-postgres-best-practices`, `tailwind-design-system` |
| App skeleton | Feature 01 built: Next 16 · 3 locales · proxy.ts · pgTAP · 27 tests green |
| MCP servers | `context7` (live docs), `playwright` (RTL verification), `supabase` (needs §1.3) |
| CI | `.github/workflows/ci.yml` — 6 jobs. Runs on push once §1.2 protection is on |
| Dependency PRs | `.github/dependabot.yml` — weekly npm, eslint held at 9.x |
| Merge gate | — removed (D18, solo project). `/review` + green CI + an explicit high-risk callout |
| Git | ✅ own repo, pushed to `github.com/Moaz-Allam/asma` (branch `master`) |

---

## 1. Do these first — they block everything

### 1.1 Make `asma` a git repository — ✅ **DONE 2026-08-18**

Verified: `git rev-parse --show-toplevel` → `D:/work/web/asma`, branch `master`, pushed.
Previously the root was `D:/work`, which meant CI could never take effect.

### 1.2 GitHub — ✅ **DONE 2026-08-18**

Pushed to `github.com/Moaz-Allam/asma`, branch `master`. **CI ran and passed** (run 32118566578).

**No CODEOWNERS, deliberately (D18).** This is a one-engineer project, so a code-owner review gate
would have the author approving their own change — a control that looks real and does nothing, which
is the same failure class as a `middleware.ts` that never runs. The file was removed rather than left
to rot. Restore it, plus branch protection, the day a second engineer joins.

Branch protection is optional now. Enabling "require status checks to pass" on `master` is still
worth a minute — it stops a red build being merged by accident.

### 1.3 Supabase — ONE project  ⏱ 15 min

Both regions run from one deployment separated by a `region` column (D14), so this is **one**
project, not two.

1. Create it at supabase.com. Save the **project ref**.
2. Account → Access Tokens → generate a personal access token (this is what the MCP server uses).
3. Copy the real values into `.env.local`. **Two are still placeholders as of 2026-08-18** —
   `NEXT_PUBLIC_SUPABASE_URL` (still `https://placeholder.supabase.co`) and `SUPABASE_DB_POOL_URL`
   (still the `postgres.ref:pw@aws-0-region…` template). The anon and service keys look real, so the
   app currently holds valid keys pointing at a non-existent project:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Settings → API)
   - `SUPABASE_SERVICE_ROLE_KEY` (same page — **secret**, never `NEXT_PUBLIC_`)
   - `SUPABASE_DB_POOL_URL` — Settings → Database → **Connection pooling**, *Transaction* mode.
     Must be port **6543** and carry `?pgbouncer=true`. The env schema rejects anything else, on
     purpose: the direct connection exhausts Postgres under serverless load.
4. Set `SUPABASE_PROJECT_REF` and `SUPABASE_ACCESS_TOKEN` in your shell environment so the
   `supabase` MCP server connects. It stays disconnected until then — expected, not a fault.
5. Initialise the CLI so pgTAP can run:
   ```bash
   npm i -D supabase && npx supabase init && npx supabase link --project-ref <ref>
   ```
   ✅ `supabase/config.toml` now exists. `supabase/tests/` and the migration template are already
   written and will be picked up. **Commit `config.toml`** — it is currently untracked.

### 1.4 Verify the whole chain  ⏱ 1 min

```bash
npm run verify
```

Runs guardrails (39) → typecheck → lint → tests (27). All four pass today.

Note `npm run verify` does **not** include `next build` or `supabase test db` — CI runs those.
Run `npx next build` yourself after any change to routing, i18n config, or `next.config.ts`.

---

## 2. Blocks Phase 2 (catalog and pricing)

**Blockers B5 and B6.** The pricing engine is generic; the data is not, and it cannot be invented.

For each launch category, supply:
- The question list — `key` (stable, never renamed), type, required, options, validation.
- **Labels in all three locales** (`ar`, `tr`, `en`) for every question, option, service, addon, zone.
- Base price and every modifier: match condition, effect type, amount or factor, order.
- Zone list per region, with multipliers.
- Commission %, unlock fee, hold period, unlock window, applicant cap — per region.

A worked example for one category beats a complete spec for none. Start with home cleaning.

---

## 3. Blocks Phase 4–5 (money)

### 3.1 PSP accounts — one per region

- **Turkey:** iyzico Marketplace (*Pazaryeri*). Sandbox credentials first.
- **KSA:** PayTabs marketplace/split. **mada support is mandatory** for Saudi cards. KYC is slow —
  start it early.

### 3.2 Answer these before writing adapter code

`progress-tracker.md` §6 — all nine are still blank, and several change the design:

1. Maximum hold duration. Must exceed `payment window + (unlock window × re-selections) + work duration + 72h`, not just 72h (G2).
2. **Can an individual be a sub-merchant?** And which sub-merchant type does each provider entity map to? iyzico has three, with **different required fields** — a company needs a tax number (G17).
3. **Settlement delay after release.** Public sources suggest up to ~60 days for new sub-merchants, 7–14 once established. Providers coming from same-day cash will not accept "released" meaning "paid in 60 days" (G16). Confirm the real figure and show two dates in the earnings UI.
4. Webhook signature scheme, retry policy, and event id for dedupe.
5. Partial refund while held — required for `PARTIALLY_RELEASED` dispute outcomes.
6. **The actual processing fee, per card type** — it must be posted as its own ledger leg (G3), never estimated.
7. Required user agreements to surface at signup (iyzico marketplace agreements are mandatory and must be accepted digitally).
8. **KSA e-invoicing scope.** We act as an **agent** (D12), so we invoice providers for commission and unlock fees — not customers for the job. Confirm the PSP does not already issue these on our behalf, and whether it can. Note the invoice type branches on each provider's own VAT registration status (G18).
9. Phone/SMS OTP availability per region.

### 3.3 Legal — blockers B2 and B9

- **B9 — confirm the agent position with a tax advisor, in both regions.** We have decided we act as
  an intermediary (D12), which keeps the job price off our books and shrinks e-invoicing to our own
  fees. Two *principal* indicators remain — **we set the price server-side and we control matching** —
  and non-custody of funds does not settle VAT treatment. The third indicator, a satisfaction
  guarantee, was **removed by D17** precisely to strengthen this position: we now offer escrow,
  vetting, and a dispute process, none of which promises the work itself. Take
  `project-overview.md` §34 as it now reads to the advisor. If it comes back "principal", VAT is owed
  on the full job price and the chart of accounts changes. **Cheaper to confirm now than after
  feature 14** — and if the answer is "principal", D17 is worth revisiting, since the reason for
  dropping the guarantee would be gone.
- Written confirmation that the custody model (funds held by a licensed PSP, we hold only a ledger
  mirror) requires no licence in either region. Record it in `progress-tracker.md`.
- T&C must state plainly that the service contract is between customer and provider, and that we act
  as intermediary and payment facilitator. This is what makes the agent position visible to a
  regulator.
- `FEATURE_STORED_BALANCE_WALLET` stays **OFF** until that is on file.
- KVKK (TR) and Saudi PDPL: the reveal model puts customer PII in the provider's hands, outside our
  system. A deletion request cannot reach it. Provider terms need a data-processing clause.
- Which language is legally authoritative for T&C and provider agreements (`i18n.md` L5).

---

## 4. Optional

- **Context7 API key** — the MCP works anonymously; a key only raises the rate limit.
  `npx ctx7 setup --claude`, or add an `Authorization: Bearer` header in `.mcp.json`.
- Error monitoring (Sentry or equivalent) — needed before Phase 7, not before Phase 0.

---

## 5. First real task

Once §1 is done:

```
/architect 01 Project Setup + Tokens
```

It will read `progress-tracker.md`, confirm the phase, and write a plan to `specs/01-project-setup/plan.md`
for you to approve before any code exists.

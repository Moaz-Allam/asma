# 0006. Provider onboarding and approval: rationale

Decision record for [index.md](index.md). `/develop` does not need this file.

## Context

> ⚠️ Premise note: the plan gives this position one day (11-03) and no buffer is left (R2). With 18 database functions,
> a scanner, two buckets, the first admin pages and the rail, a day and a half is the honest estimate. Each cut that
> would close the gap was offered and declined, so the owner holds that trade. Two things stay open beside it: 01 part 2
> must merge first, and 01's real calls and reviews are still owed, so this position would stack on code nobody has
> reviewed.

Position 02 is the first feature that stores special categories of personal data: a selfie with an ID, and a criminal
record, under KVKK. It is also the first use of Storage, the first admin page, and the first id in a URL. Assumed from
earlier work: Supabase Auth and `profiles` (spec 0005), EU hosting (D62), the `audit_log` table (D102).

Forces that shaped the design:

- **The APIs are public.** A signed in provider holds a real token and can call `/rest/v1` and `/storage/v1` directly.
  Any rule only in a Server Action protects honest users and nobody else.
- **Vercel caps a function body at 4.5 MB** (D83), and the design allows 10 MB files.
- **The service role is for webhooks, jobs and the relay** (door rule), so a request path cannot lean on it.
- **The bio reaches customers at 06.** A phone number in it goes around both fees (rule 2, D89).
- **Zones and services arrive in 03**, after 02, so `p4` cannot be built yet.
- **Twilio Verify sends codes only** (D97), and email needs 13, so nothing can notify a provider today.
- **The owner reviews alone**, and the WhatsApp group holds 400 or more people, so the queue must be quick to work through.

## Options considered

### How files reach Storage

**Browser to Storage, then register (chosen).** Storage policies confine a provider to their own folder, the bucket limits declared
type and size, and a database function checks the object before any row exists.

- Pros: no size trouble, no service role, the upload does not spend a function invocation.
- Cons: the real bytes are checked only in the browser, which a direct call skips; a provider can leave objects that no row points to.

**Our own route with the service role.** The server sees every byte.

- Pros: the byte check cannot be skipped, and the path is the server's choice.
- Cons: the service role enters a request path, every file must fit under 4.5 MB, and a route handles personal files in memory.

**Signed upload link from the server.** The server picks the path, the browser uploads.

- Pros: no client chosen path.
- Cons: needs the insert right or the service role anyway, and adds a round trip for no new protection.

### Where the scanner lives

**One scanner in the database (chosen).**

- Pros: a direct call cannot skip it, 05 reuses it, and there is one copy.
- Cons: spelled digits in three languages are awkward in SQL, and the `p2` chip shows after save, not while typing.

**Database plus a browser copy.** Pros: the live chip as drawn. Cons: two scanners to keep equal, about two more hours.

**App code only.** Pros: easiest to write and test. Cons: a direct call to the save function skips it, which is a hole in rule 2.

### How many states

**Five states (chosen).** One admin decision. Cons: the `a1` bar waits for 19.

**The full funnel of §30.** Pros: matches `a1`. Cons: needs rules for a background check, an assessment and a probation that nobody has
defined, and 19 is P2.

### Old files

**Keep, then purge by a job in 21 (recommended, not chosen).** Pros: history for a fraud question, and no delete right for any user. Cons: more
data held for longer.

**Delete at once on replace (the owner's choice).** Pros: least data held, the simplest answer under KVKK. Cons: no copy of a replaced file.

**Keep with no plan.** Pros: nothing to build. Cons: hard to defend under KVKK.

## Rationale

The public APIs decide nearly everything. Since a hostile provider can skip the app, every rule that must hold sits in Postgres, and the
Server Actions only add what the database cannot do (signing links, removing objects). That is why no API role writes the three tables, and
why definer functions do, each in one transaction with its audit row. It is the same shape as `complete_onboarding`, so nothing new has to be
learned. The 10 MB limit and the service role rule together leave only the browser path. Its one weakness, a skippable byte check, costs a useless
file in the attacker's own private folder, while the other two options cost a rule of the project.

The first draft read the bytes in a Server Action as well. The cross check pointed out that a hostile client skips that step just as it skips the
browser's, so it protected nothing, and it needed a signed link, a `Range` read of uncertain support and a removal path. The owner agreed to move
the check to the browser, before any upload. That overrides the letter of `architecture.md` §14, on purpose: the check catches honest mistakes, and
no check of ours could stop a hostile one without the service role.

The scanner is in SQL for the same reason. It is the awkward place to write it, but a scanner that can be walked around is not worth having.

**The owner chose delete at once over the recommendation to keep and purge later.** The recommendation named a risk: a delete right would let a
provider erase a file under review through the API. The design closes that risk: the delete policy only reaches objects no row points to, so the
current file cannot be touched, and the action can still clean up. What remains is the trade the owner accepted: a replaced file is gone, so a forged
ID swapped for a clean one leaves no copy, only audit rows.

Moving `p4` to 05 is safe because `p4`'s own note says services need no review, so approval does not depend on them. 05 is also the position whose
feed reads those choices.

Tax numbers survive D87 for one reason: B9 may make invoicing P0, and chasing every company after launch costs more than one field now. They are
company details, not personal ones, and stay admin only. A sole trader's tax number can be their national ID, so the field takes exactly 10 digits in
TR, which an 11 digit ID cannot meet. The ID number goes the other way: the image already proves identity, and a stored national ID would add risk
with no use.

Admin is trusted (D10) but the owner asked for one audit row per view, and a row that a direct API call can skip records little. So Storage itself
needs a fresh view row before an admin read, and Match needs one for that exact object. `object_id` exists for the same reason: a path is chosen by
the client and is free again after a replace, so only the object's own id proves what admin saw.

## Calls made while writing

Each is a small call the design needed. The runner up is named.

| Call | Why | Runner up |
| --- | --- | --- |
| `providers.id` equals `profiles.id` | `auth.uid()` works in every policy with no join | A separate id with `profile_id`, as `architecture.md` §13 draws |
| A trigger on `profiles` creates the row | Every provider has a row, and `complete_onboarding` stays as merged | Upserts in two functions |
| Two tables, `providers` and `provider_profiles` | 06 opens one to customers and never touches tax fields | One table with column grants |
| One row per file, `id_front` and `id_back` apart | One row maps to one object, and replace stays simple. The verdict takes both | One row with two paths |
| Two buckets | A wrong policy at 06 cannot reach an ID | One bucket with a path rule |
| Photo is a `provider_documents` row | Same review, same replace rule, no new table | Columns on `provider_profiles` |
| `valid_until` is a date, compared with `current_date` | Admin types a date from a document; three hours off does not matter | `timestamptz` per region |
| Expiry read on the fly | No job, and it cannot go stale | A daily job |
| A 60 second signed link | An image loads at once and a new tab opens at once | 300 seconds |
| Photo link at 300 seconds, in the render | A provider's own page; a page does not reload in that time | A Server Action per view |
| Images downscaled in the browser, 1024 px and 2400 px | Drops EXIF location, saves upload time on phones and Storage space | Upload as is, strip on the server (Pro only) |
| `cacheControl: '0'` | An ID should not sit in a browser cache on a shared computer | The default of one hour |
| `is_admin()` reads `profiles.role`, in every new policy and function | A demotion counts at once, while a token lags up to an hour, and a fresh promotion would see an empty queue | The JWT claim, as the tables of 01 do |
| `decide_provider` compares `providers.updated_at` | One version covers name, legal name and bio | Two arguments with the names seen |
| Replacing one ID side returns a rejected twin to `pending` | One verdict covers both sides, so a provider would have to upload a good side again | A verdict per side |
| A pending certificate does not block approval | It is optional, and nothing shows it as verified | Must be reviewed first |
| Suspend only from `approved` | A bad file in review is simply rejected | Any state, with a stored previous state |
| Any registered file sends an approved provider back to review, even the optional one | One rule, and the design says "any document" | Exempt the certificate |
| An optional certificate that was rejected does not block approval | There is no way to delete it, so it would trap the provider | Block until replaced |
| A rejected file needs a required document rejected, or a note | A rude bio has no document to reject | Six chips only |
| 20 objects per provider | Six are needed, and it stops a storage attack, not an honest user | No cap |
| `provider_standing()` is SQL | One source for the page and the gate | A TypeScript copy |
| `scrubUrl` cuts Storage URLs only; uuids in page URLs stay | Spec 0004 keeps them, and a test pins it. Internal ids are allowed | Replace every uuid with `:id` |
| e2e admin signs up for real, then `supabase db query --local` runs `promote_to_admin` | A seed file would clash with two pgTAP tests, and a SQL made user may not sign in | One admin per project in `supabase/seed.sql` |

## Cross check

2026-11-01, on Sonnet, in fresh context, read only: 15 decision gaps and 15 soundness findings, verdict "ready after the listed fixes". The main claims were
checked against the repo and held. All were applied on the owner's pick, except four changes: the `:id` scrub was dropped, the seed file became a real sign
up, the two seen names became one version, and the tax number got exact digits per region. Four consequences stay as recorded tradeoffs (see Consequences).

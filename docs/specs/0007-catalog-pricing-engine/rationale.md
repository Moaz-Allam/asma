# 0007. Catalog and pricing engine: rationale

Decision record for [index.md](index.md). `/develop` does not need this file.

## Context

> ⚠️ Premise note: the owner's pace is one position a day, and this one is honestly about a day and a half, even after four cuts. The
> plan had given it two days, so the schedule still holds if 02 ends on time, but 02 is itself over its day and rests on 01 part 2,
> which is not merged. The owner picked the full scope knowing this. S17's first category was due 11-03: the build does not wait for
> it, 04 does for real prices.

Every price the platform ever shows comes from this position, so a mistake here costs money on every job. Forces that shaped the
design:

- **The APIs are public.** A signed in customer holds a real token and can call `/rest/v1` directly. 04 must store a price somehow, and
  whatever writes it must not take the price from a caller who could lie.
- **The service role is for webhooks, jobs and the relay** (door rule, D116), so a request path cannot lean on it.
- **Rule 4 allows no float**, and a multiplier of 1.30 is not a float in `numeric`, but it is in a JavaScript number.
- **Rule 1's text names `lib/pricing/`** as the place rows are evaluated, written before the threat model of 0006 was settled.
- **Real data does not exist yet** (B5, B6), and the owner's standing rule forbids inventing it.
- **`app-05` and `s4` disagree.** The admin screen draws questions and addons on a category, the customer screen draws both on a service.

## Options considered

### Where the engine lives

**In Postgres (chosen, owner 2026-11-02).** Functions read the rows, `lib/pricing/` is a thin door, 04's `create_request` calls `quote_price` in its transaction.

- Pros: no caller can supply a price, price and request commit together, exact `numeric`, no service role, formula rows stay private.
- Cons: PL/pgSQL is harder to read, property tests are weaker, rule 1's wording and §19.6 change.

**In TypeScript, with the service role writing the request.** `lib/pricing/` computes as rule 1 says.

- Pros: easy to read, fast-check reaches it, matches every older document.
- Cons: the service role enters a request path, and float safety needs BigInt rationals by hand.

**In TypeScript, with a signed quote.** The server signs each price and a database function checks the signature.

- Pros: no service role, TypeScript stays.
- Cons: a secret stored in Postgres, expiry rules, and two places that know what a quote is.

### How admin writes the catalog

**Direct writes under RLS, one audit trigger, one publish function (chosen).** Column grants hold what must not change.

- Pros: few functions, a change from the SQL editor is audited too, the shape `platform_settings` already uses.
- Cons: two check helpers need a grant, because a check runs as the caller; a move is two writes.

**Definer functions for every write, as 0006 does.** Pros: one shape across positions. Cons: about ten more functions for rows only an admin touches,
where the threat in 0006 was a hostile provider.

### How a formula changes

**Immutable versions, draft in the browser (chosen).** Publish sends the whole formula.

- Pros: old rows are the history, an edit can never touch what a request was priced from, no draft state on the server.
- Cons: a draft is lost on reload.

**Edit rows in place, bump a number.** Pros: simpler editor. Cons: the version number no longer says what the formula was, so only the snapshot could.

## Rationale

The public APIs decide this as they decided 0006. A price computed in TypeScript has to cross to the database through a caller, and every way of making that
caller trustworthy costs a rule of the project. Computing inside the database removes the crossing, so the tamper test becomes a property of the function
signature rather than something the action has to remember. Exact `numeric` removes the float question at the same time. The cost is real, and it is paid
once, in one file, by pgTAP.

Direct writes for the five simple tables are the lean choice: the threat there is a mistaken admin, not a hostile user, so grants plus a trigger are enough, and
the only table with cross row rules gets one guard. The formula tables get the opposite treatment because history is the point of them.

`app-05` against `s4` is settled by precedence and sense: `architecture.md` and the customer screen agree, and the price is sold to the customer, so a question
can be general or service only, and an addon belongs to a service. A formula per service follows, because `s4` prices each service from its own base.

Owner picks of 2026-11-02: the engine in Postgres, knowing rule 1's wording changes; whole lira, half up, stored per region; all four cuts; both pages in one pull
request; the landing swap waits for S17.

## Calls made while writing

Each is a small call the design needed. The runner up is named.

| Call | Why | Runner up |
| --- | --- | --- |
| The engine stops at the job price | Fee settings and their values arrive in 07 (D95), and 04 stores `fixed_price` only. Feature notes returned the commission too | Add a commission setting now, with no value from S17 |
| `questions.category_id` is always set, `service_id` is null for all services | One unique key across the category, so a modifier's key has one meaning | Exactly one of the two, as `architecture.md` draws |
| Addons on a service | `s4` and `architecture.md` | On a category, as `app-05` draws |
| No `city` on zones | Multi city is out of this release, and `p4` draws a flat list | A `city` column nobody reads |
| `pricing_modifiers.active` gone | A version replaces it | Keep it, with two ways to retire a modifier |
| `question_in_use` refuses, rather than warns | A modifier on an inactive question silently lowers a price | Warn and confirm, as the old feature notes said |
| Negative `FIXED` amounts allowed, with a floor on the price | `s4` draws a studio discount | Multipliers below 1 only |
| The ceiling is the D13 multiple, checked per quote | Already seeded and confirmed. G11 proposed a figure per service, which is one more setting per service | A worst case check at publish, which needs a search over answers |
| A missing setting refuses, never defaults | A wrong rounding unit prices every job wrongly and silently | Fall back to 100 and 20 |
| New rows start off | Nothing half entered reaches a customer | On by default |
| Customers read no catalog table in 03 | No customer page exists yet, and 04 opens exactly what it needs | Read policies on active rows now |
| Answers are checked in SQL, with no runtime Zod | The check must hold on a direct call, and a second copy would drift. `quote_price` answers `{ key, code }`, so 04's form can show them | Build the Zod schema as §19.6 says, as well |
| A preview checks priced questions only | A required note cannot change a price, and would block the panel | Ask for every required question |
| Text answers pass `has_contact_info` in the engine's validator | `i18n.md` §5, and rule 2: providers read them before the reveal | Leave it to 04 |
| `numeric(3,2)` for zones, 0.50 to 2.00 | As `app-05` steps. Modifiers keep §19.4's 0.1 to 10 | One range for both |
| Amounts capped at 100000000 minor units | A base of ₺1,000,000 at 20 times stays well inside a safe JavaScript integer | No cap |
| `catalog_audit` writes on every real change, moves included | One rule, and a move is two small rows | Skip order changes |
| Column grants, not a guard trigger, keep `key` and `type` | A grant fails before any code runs | A trigger |
| Lists read at most 200 rows, with no pagination | Nothing near that is expected in a catalog | Page them |
| 400 ms delay on the test panel | Typing an amount fires once. The customer form in 04 can reuse it | A Calculate button, which is not what `app-06` draws |
| Every priced question is `required`, except a `multi_select` | A skipped surcharge is a lower price chosen by the customer, while an empty multi select just means none | Allow it, and trust admin |
| `price_out_of_range` logs and `pricing_settings_invalid` alerts | A customer's own answers can reach the first, so an alert would let anyone spend the error quota and send email. 04 alerts at submit | Alert on both |
| `pricing_history_guard` on both formula tables | Grants stop the API, and this stops a later definer function or the SQL editor too. History is the point of these rows | Grants alone |
| A move renumbers its scope | A swap cannot separate two equal orders | Swap two rows |
| The first active region, with no pin, and 16's switch before KSA | Nothing may hardcode Turkey, and only one region is live until after launch | Pin TR until 16, as the cross check offered |
| `pricing_quote_active` dropped | `auth.uid()` holds inside a definer function, so 04 can call `quote_price` | A separate inner function |

## Cross check

2026-11-02, on Sonnet, in fresh context, read only: 13 decision gaps and 9 soundness findings (2 major), verdict "ready after the listed fixes". All 15 worked figures
recomputed right, and every AC traced to a task and a test. The main claims were checked against the repo and held. All were applied on the owner's pick, with one
change: no pin on TR. No SQL was run, so the lock and PostgREST facts are for the builder's pgTAP to prove.

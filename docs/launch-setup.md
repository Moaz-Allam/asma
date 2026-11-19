# Launch setup: every account and setting before Aldebyani goes live

For the owner. This is the order to set things up for the Turkey launch, and what to do in each service. It follows
the owner steps (S) in `context/progress-tracker.md` §5; that table stays the record of what is done. Where this
guide and the tracker disagree, the tracker wins.

**Golden rules while you do this**

- Secrets (API keys, auth tokens, passwords) go straight into Vercel's environment settings, Supabase, or your own
  local env file. Never into chat, a commit, or a screenshot. The variable names are listed in `.env.example`.
- Use the sandbox or test mode of each service first. Switch to live keys only at gate G3.
- After each step, tell the agent "S-number done". It then checks what it can (read only) and records it.
- Anything marked **Ask in writing** must come back as an email or a ticket answer, because the code relies on it.

## The order

| # | Step | Why this order | Owner step |
| --- | --- | --- | --- |
| 1 | Domain at Hostinger, DNS on Cloudflare | Everything else (mail, Turnstile, Vercel, iyzico's site check) needs the real domain | S4 |
| 2 | Vercel: domain, then the Pro plan | Hobby forbids commercial use; the domain gives the real `https://` address | S3, G3 |
| 3 | Supabase: Pro plan, staging project, Vault secrets | The database, the cron jobs and the relay wake up from here | S6, S33, S34 |
| 4 | Twilio Verify | Sign in is by SMS code; nobody can sign in without it | S20, S22 |
| 5 | Cloudflare Turnstile | The bot check on the login page | S9, S22 |
| 6 | Resend | Transactional email (position 13) | S5, S43 |
| 7 | iyzico: sandbox, then live | Card payments of the two platform fees | S1, S2, S37 |
| 8 | Sentry, PostHog, uptime monitor | You hear about failures before customers do | S7, S8, S10, S32 |
| 9 | Legal, tax, catalogue, translation | The launch gate holds every draft text until these are done | S16, S17, S21 |
| 10 | The switches on launch day | Payments and mail turn on per region with one row each | S37, S43 |

---

## 1. Domain at Hostinger, DNS on Cloudflare (S4)

You can buy the domain at Hostinger. The project manages DNS in Cloudflare (Turnstile and the firewall live there
too), so the recommended setup is: **buy at Hostinger, point its nameservers at Cloudflare.**

1. **Buy the domain.** In Hostinger, search for and buy the name (for example `aldebyani.com`). If you want
   `.com.tr`, check that Hostinger sells it and which documents it asks for. `.com.tr` needs proof of a Turkish
   business or trademark, and Cloudflare Registrar does not sell it.
2. **Add the domain to Cloudflare.** Create a free Cloudflare account, choose Add a site, enter the domain, and pick
   the Free plan. Cloudflare scans the existing records and shows two nameservers, such as `xxx.ns.cloudflare.com`.
3. **Change the nameservers in Hostinger.** In hPanel, open Domains, pick the domain, and choose DNS / Nameservers,
   then Change nameservers. Enter the two Cloudflare nameservers and save. This can take up to 24 hours; Cloudflare
   emails you when the domain is active.
4. **Turn on safe defaults in Cloudflare.** Under SSL/TLS, choose Full (strict). Under DNS, records for Vercel and
   Resend must be **DNS only** (grey cloud), not proxied.
5. **Mailboxes (optional).** If you want a real inbox such as `support@your-domain` (Hostinger Email, Google
   Workspace or Zoho), add that provider's MX and SPF records on the **root** domain. Resend uses the `send.`
   subdomain (step 6), so the two never clash.
6. **Tell the agent the domain name.** It wires `APP_SITE_URL`, the Turnstile hostnames and the Resend sender to it.

If you would rather keep DNS at Hostinger, every record below goes into hPanel's DNS records page instead. It works
the same; you lose the Cloudflare firewall and rate limiting in front of the site.

## 2. Vercel (S3, S23, gate G3)

1. **Add the domain.** In the `aldebyani` project, open Settings and then Domains. Add `your-domain` and
   `www.your-domain`. Vercel shows the exact records (an `A` record for the apex and a `CNAME` for `www`). Add them in
   Cloudflare as DNS only, then wait for Vercel to show Valid.
2. **Set the site address.** Set `APP_SITE_URL=https://your-domain` in the Production scope.
3. **Upgrade to Pro before real users** (gate G3). The Hobby plan forbids commercial use.
4. **Firewall rate limits (S23, Pro only).** Ask the agent for the rule set. It covers the pages, `/api/health`,
   and the telemetry relays `/api/e`, `/api/a/*` and `/api/csp`.
5. **Check the environment.** Every name in `.env.example` that production needs must be set in **both**
   Production and Preview. A deployment refuses to boot when a required key is missing (`lib/deployment.ts`), and the
   error names the missing variable.

## 3. Supabase (S6, S33, S34)

1. **Pro plan at launch** (D63). The Free plan pauses inactive projects and has no daily backups.
2. **Staging project (S34).** Create a second project (Free), `aldebyani-staging`, in `eu-central-1`. Point the Vercel
   **Preview** scope at it, using its URL and keys, and use the iyzico sandbox keys there. Production keeps only live
   keys. Load tests and restore drills run on staging, never on production.
3. **Relay secret and URL (S33).** Generate a long random value (at least 32 characters, for example with a password
   manager). Then:
   - set it in Vercel as `RELAY_SECRET` (Production and Preview);
   - in Supabase, open Project Settings, then Vault, and add two secrets: `relay_secret` (the same value) and
     `relay_url` (`https://your-domain/api/relay`).

   Without these the cron jobs cannot wake the relay, so no payment is checked and no mail is sent.
4. **Auth settings come with Twilio and Turnstile** (steps 4 and 5).

## 4. Twilio Verify, the SMS codes (S20, S22)

Supabase Auth calls Twilio itself. The app never holds a Twilio key.

1. **Account.** Sign up at twilio.com, verify your details, and **add funds** (a trial account only texts verified
   numbers).
2. **A Verify service.** Open Verify, then Services, then Create. Name it `Aldebyani` and use 6 digit codes. Note the
   **Service SID** (starts with `VA`).
3. **Fraud Guard on.** In the service, open the SMS tab and turn on Fraud Guard (it blocks SMS pumping fraud).
4. **Geo permissions.** In Verify's settings, allow **Turkey only**. Add Saudi Arabia later with the KSA launch.
5. **Usage alert.** Under Billing, add a usage trigger (for example at 50 USD a day) that emails you.
6. **Ask in writing (R7).** Ask Twilio support: "Does Verify deliver SMS to Turkish networks after 2026-11-18 without
   our own sender ID registration, or must we register one? What is the price per SMS to Turkey?" Turkish carriers
   block unregistered alphanumeric senders, so the answer decides whether you must register a sender ID with Twilio
   (company documents, a few weeks of lead time).
7. **Supabase Auth (S22),** in the production project, in this order:
   1. Authentication, then Providers, then Phone: on, provider **Twilio Verify**. Enter the Account SID, the Auth Token
      and the Verify Service SID. Turn **Confirm phone** on.
   2. Email provider off, anonymous sign ins off, manual linking off.
   3. Hooks: **Before User Created** on, type Postgres, function `public.check_new_user`.
   4. Attack Protection: CAPTCHA on, provider **Turnstile**, with the Turnstile **secret** from step 5.
   5. Rate limits: SMS per hour 200; the OTP window per phone 60 seconds.
8. **Test.** Sign in on the preview with your own Turkish number. The agent runs spec 0005's real calls after you say
   S22 is done.

## 5. Cloudflare Turnstile (S9)

1. In Cloudflare, open Turnstile and choose Add widget. Name it `Aldebyani login`, mode **Managed**.
2. Hostnames: `your-domain`, `www.your-domain`, `aldebyani.vercel.app`, and the preview hostname you test on. Do
   **not** add `localhost` (D104).
3. The **site key** goes into Vercel as `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (both scopes). The **secret key** goes only
   into Supabase's CAPTCHA setting (step 4.7), never into Vercel.

## 6. Resend, transactional email (S5, S43)

1. **Account and plan.** Sign up at resend.com. Choose Pro if you expect more than the free plan's daily limit.
2. **Add the sending domain.** Open Domains, then Add domain, and enter `send.your-domain` (a subdomain keeps it apart
   from any inbox on the root). Pick the region **eu-west-1 (Ireland)**, to keep data in the EU (D62); the region
   cannot change later.
3. **Add the DNS records Resend shows** in Cloudflare, as DNS only. Resend shows the exact names and values:
   - an `MX` and a `TXT` (SPF) record on `send.your-domain`;
   - a `TXT` DKIM record named `resend._domainkey.send` (or similar).

   Also add a **DMARC** record if you have none: `TXT` on `_dmarc.your-domain` with the value
   `v=DMARC1; p=none; rua=mailto:you@your-domain`. Move to `p=quarantine` after a few clean weeks.
4. **Verify.** Press Verify in Resend and wait for every record to show Verified.
5. **Tracking off.** In the domain's settings, turn **open tracking** and **click tracking** off (spec 0011-13 AC-8).
   The links in our mails must stay plain.
6. **A sending only API key.** Open API Keys, then Create, with permission **Sending access** limited to this
   domain.
7. **Vercel (S43),** Production and Preview:
   - `EMAIL_DRIVER=resend`
   - `EMAIL_API_KEY=` the key from item 6
   - `EMAIL_FROM=Aldebyani <no-reply@send.your-domain>`
8. **Turn mail on for Turkey.** Ask the agent, or run this in the Supabase SQL editor:

   ```sql
   update public.platform_settings set value = 'true' where region = 'TR' and key = 'emails_enabled';
   ```

   Then announce a date to providers. On that date run the same update for `apply_needs_email`. From then on a
   provider needs a confirmed email to apply.
9. **Before step 8,** finish the R18 items with the agent: pending mail rows past their deadline ended stale, a
   tighter email check, and an alert when mail is on but the driver is off.
10. **Optional: Supabase SMTP.** Only if you ever turn the email sign in on (it is off). Then point Authentication,
    then SMTP, at `smtp.resend.com`, port 465, user `resend`, with an API key as the password.

## 7. iyzico, the card payments (S1, S2, S37; position 08b)

The platform takes only its two fees by card: the customer's commission and the provider's fee. The job price is
cash, outside iyzico (D87). The standard hosted checkout is enough; no marketplace or sub merchant product is
needed (D93).

### 7a. Sandbox first (S1)

1. Create a sandbox merchant account at iyzico's sandbox panel. Copy the sandbox **API key** and **secret key** into
   your local env file as `IYZICO_API_KEY` and `IYZICO_SECRET_KEY`, with
   `IYZICO_BASE_URL=https://sandbox-api.iyzipay.com`.
2. In the sandbox, make one payment through the standard hosted checkout, using iyzico's test cards, and one
   refund.
3. Note for the agent (no secrets):
   - what the callback sends back;
   - how a notification (webhook) is signed;
   - which field identifies an event once;
   - what a refund answers.

   These fill §7 of the tracker and unblock position 08b (the real iyzico driver).
4. **Ask iyzico:** "Does our existing account allow the standard hosted checkout (Checkout Form / Ödeme Formu)?"

### 7b. Live account (S2)

1. **Merchant application.** iyzico checks the business and the website before going live. Expect to provide:
   - the company documents: tax plate (vergi levhası), signature circular (imza sirküleri), trade registry gazette;
   - an IBAN in the company's name.

   It also expects these pages on the site, linked in the footer:
   - the distance sales contract (mesafeli satış sözleşmesi) and the preliminary information form;
   - the privacy notice (KVKK aydınlatma metni);
   - cancellation and refund terms;
   - contact details with a postal address.

   Confirm the exact list with iyzico. The legal texts come from step 9.
2. **Ask in writing:**
   - the real per card fees (domestic, foreign, installments);
   - the settlement delay into your account;
   - which agreements users must accept.
3. **Live keys.** Put them into Vercel **Production** only:
   - `PSP_DRIVER=iyzico`
   - `IYZICO_API_KEY`
   - `IYZICO_SECRET_KEY`
   - `IYZICO_WEBHOOK_SECRET`, if iyzico gives a separate one
   - `IYZICO_BASE_URL=https://api.iyzipay.com`

   Preview keeps the sandbox values. A deployment refuses the live host off production.
4. **Notification URL.** In the merchant panel's notification (webhook) setting, enter
   `https://your-domain/api/psp/webhook`. The return address of the hosted page is set by the code
   (`/api/psp/callback`).
5. **Turn payments on (S37), on launch day:**

   ```sql
   update public.platform_settings set value = 'true' where region = 'TR' and key = 'payments_enabled';
   ```

   Also check that Vault's `relay_url` points at production.

## 8. Monitoring (S7, S8, S10, S32)

- **Sentry (S32):** create a second, server only project in the `aldebyani` org (EU). Put its DSN into Vercel as
  `SENTRY_SERVER_DSN`, never as a `NEXT_PUBLIC_` variable. It is required when `PSP_DRIVER=iyzico`.
- **Sentry inbound filters:** finish the one setting left in S7.
- **PostHog (S8):** already set up. Nothing else unless the agent asks.
- **Uptime monitor (S10):** any monitor (UptimeRobot, Better Stack and others have free plans). Check
  `https://your-domain/api/health` every 5 minutes, with alerts to your phone and email.
- **Support WhatsApp (S25):** one number in E.164 (`+90…`), stored as the `support_whatsapp` setting for `TR`.

## 9. Legal, tax, content (S16, S17, S18, S21; blockers B2 to B10)

Nothing here is code, but `npm run launch:gate` (run at G3) fails while any `[draft]` or `[tr]` text remains.

- **A Turkish lawyer (S16, B2, B10):**
  - the terms;
  - the KVKK privacy notice;
  - the provider agreement with its data processing clause;
  - the distance sales texts iyzico asks for;
  - the cash model (the service contract and the cash are between customer and provider; we take only our two
    fees);
  - the fee refund wording;
  - the legal action clause (D92).

  Ask them as well whether you must register in **VERBIS** (the data controllers registry) and **ETBİS** (the
  e-commerce registry), and what the criminal record check on providers requires.
- **An accountant (B9):**
  - the tax position of the commission and the provider fee;
  - e-invoice (e-Fatura or e-Arşiv) for each fee you charge;
  - whether iyzico's fee is deductible.
- **Catalogue (S17, B5, B6):**
  - the launch categories;
  - each service's questions, prices, modifiers, hours and districts;
  - the commission percent and the provider fee.

  The agent seeds them through the admin pages, never invents them.
- **Turkish translation (S21):** a native translator for every `[tr]` string, and a copy review of every `[draft]`
  mail and page text.
- **Public claims (S18, B7, B8):** any quality claim on the landing page needs a figure behind it.

## 10. Launch day checklist

1. G3 checks green: `npm run launch:gate` passes, CI green, the security review at G3 done.
2. Vercel on Pro with the domain live, and the firewall limits on.
3. Supabase on Pro; Vault `relay_url` set to production; `RELAY_SECRET` matching.
4. Supabase Auth: Twilio Verify on, the CAPTCHA on, the rate limits set. A test sign in with a real number works.
5. iyzico live keys in Production, and the notification URL set. One real payment of a small fee, then its refund,
   by you.
6. `payments_enabled` true for `TR`.
7. Resend verified, tracking off, keys in Vercel. `emails_enabled` true for `TR`. Send yourself a confirmation link.
8. Uptime monitor and Sentry alerts reach your phone.
9. Staging stays on sandbox keys for every later test.

---

## Testing with many simulated users after launch

Yes. Open source load testing tools can drive a thousand or more scripted users through the real journeys:

- **k6** (Grafana, AGPL-3.0): JavaScript scenarios, with weighted user types such as customers posting and
  providers applying. Its browser module drives real Chromium pages too.
- **Locust** (MIT): Python user classes with weighted tasks and wait times, the closest to mimicking how people
  behave. It runs distributed across workers.
- **Artillery** (MPL-2.0): YAML scenarios. Its Playwright engine runs real browser bots, but a thousand real
  browsers need many machines, so mix a few browser bots with many HTTP bots.

**Run it on the staging project (S34), never on production:**
- test phone numbers with a fixed code in Supabase Auth, so no SMS is paid for;
- `PSP_DRIVER=fake` and `EMAIL_DRIVER=off`;
- Turnstile's always pass test keys;
- seeded test catalogue rows;
- a script to delete the test data afterwards.

Production SMS, card payments and mail would cost money, reach real people, and trip Twilio's and iyzico's fraud
checks. Spec 0011-21 already plans a load check on staging; ask the agent to build it there when you get to it.

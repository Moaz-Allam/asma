# 0013. Test phones: exact numbers outside TR and KSA may sign up

**Date**: 2026-11-23
**Status**: Accepted (owner, in chat, D224)

## Summary

You can test sign up with real SMS on a Twilio trial account, which sends only to numbers you verified in Twilio, even
when that number is not Turkish or Saudi. The owner lists exact numbers in a private database table; each is filed as
region TR. With the table empty, nothing changes from launch behaviour (D16).

## Context

Phone numbers are locked to TR (+90 mobile) and KSA (+966 mobile) on purpose (D16), in the browser form, the
`before_user_created` hook, `phone_region()` and the `profiles` check. The owner's only verified Twilio trial number is
Egyptian (+20), so a real SMS test of sign up was impossible. The owner chose to open a narrow, owner controlled path
over testing with a fake Supabase test number.

## Requirements

- **AC-1**: `test_phones` (phone E.164 primary key, region default `TR`, note, created_at) with RLS on, a deny policy,
  and no grant to `anon`, `authenticated` or `service_role`; a real TR or KSA mobile can never be listed.
- **AC-2**: `phone_region()` returns the listed region for a listed number, after the two literal patterns; an unlisted
  number outside them stays null, so the hook refuses it (`phone_not_supported`).
- **AC-3**: the `profiles` check becomes an E.164 shape check plus the guard trigger `profiles_phone_region`, for every
  role, refusing a phone whose `phone_region()` differs from the row's region (`phone_region_mismatch`).
- **AC-4**: the sign in forms accept a number with a dial code in `NEXT_PUBLIC_PHONE_TEST_DIAL_CODES` (comma list,
  unset by default) and send it as E.164; a region number still wins; the database decides.
- **AC-5**: tests: pgTAP `44_test_phones` (grants, RLS, region, hook, guard), unit tests for the helper and that the
  literal patterns still agree (`tests/region-phone.test.ts`).

## Decision

**Chosen option**: an exact allow list in the database, owner written, plus an off by default dial code switch in the
browser. Runner up: a dial code allow list in the database (any +20 number), refused as too wide.

## Rationale

Exact numbers keep the hole as small as the test needs; the database stays the authority, so a browser flag alone opens
nothing. Region TR keeps every region keyed rule (prices, currency, feeds) working for the test account. Phone numbers
never enter git: the owner inserts them in the SQL editor.

## Consequences

- An Egyptian test account behaves as a TR customer or provider (TRY, Istanbul time); SMS goes to Egypt through Twilio.
- `profiles` loses its literal check; the guard trigger now carries D16.
- Before launch (G3): empty `test_phones` on production and unset the env var (Follow-up).

## Follow-up

- [ ] Owner: insert the verified number, set `NEXT_PUBLIC_PHONE_TEST_DIAL_CODES=+20` on Vercel and redeploy.
- [ ] G3 checklist: `test_phones` empty and the env var unset on production.

# Vendored: twilio-verify-send-otp

| | |
| --- | --- |
| Source | `twilio/ai`, path `skills/twilio/twilio-verify-send-otp/` (public beta) |
| Pinned commit | `803790a` (`803790a281f0ef11d2928ffb41bc8422237fb434`, 2026-10-22) |
| License | MIT (copy in `LICENSE`) |
| Reviewed | 2026-10-31, read in full before vendoring |
| Used for | Facts about Twilio Verify for position 01 (spec 0005 S20, AC-5; D97, D103) |

`SKILL.md` is a byte for byte copy of the pinned commit (SHA-256
`d429cf42cef804ab3cafd2c66444fed093d72081810783a6af0b7f0e09606f38`).

## Left out

`agents/`, `assets/`: another tool's metadata and icons.

## Overrides (our docs win)

- **Facts only, never code.** D97: Supabase Auth calls Twilio Verify through its built in provider. We install
  no `twilio` SDK, hold no Twilio credential in the app, and write no send or check code of our own.
- The credential variables it names (`TWILIO_ACCOUNT_SID` and the rest) never enter this repo or Vercel. They
  live only in the Supabase dashboard (S20, S22).
- Facts this copy gives for AC-5: a code lives 10 minutes, 5 checks per verification, 5 sends per phone per
  service per 10 minutes, error 60202 (too many checks), 60203 (too many sends), 60410 (geo permission).
- The WhatsApp, voice, email and TOTP sections do not apply (D55).

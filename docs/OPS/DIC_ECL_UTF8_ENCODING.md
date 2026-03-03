# DIC / Enhanced Conversions Pipeline — UTF-8 Encoding

**ECL pipeline uses UTF-8 only; Latin1 is not used.**

This document states where encoding is enforced for the Deterministic Identity-to-Conversion (DIC) and Google Enhanced Conversions (ECL) pipeline.

## Where encoding is enforced

| Layer | Enforcement |
|-------|--------------|
| **Database** | `client_encoding = 'UTF8'` (Supabase/Postgres). Migrations and schema use UTF-8; phone and identity columns are stored in UTF-8. |
| **Hash input** | All identity hashing in `lib/dic/identity-hash.ts` uses `Buffer.from(value, 'utf8')`. No Latin1 or other encoding. |
| **E.164 normalization** | `lib/dic/e164.ts` consumes and produces strings; at hash time the E.164 string is passed to the hash module as UTF-8. |

## Rules

- **No Latin1:** Do not use `'latin1'` or `'binary'` when building inputs to the DIC hash pipeline.
- **Explicit UTF-8 at hash:** Use `Buffer.from(str, 'utf8')` (or equivalent) before SHA256 for phone and other identifiers.
- **DB columns:** Phone and user-agent columns used for DIC/ECL are text in a UTF-8 database; ensure ingest and APIs do not introduce Latin1 data.

## Related code

- `lib/dic/identity-hash.ts` — `sha256HexUtf8`, `hashPhoneForEC`
- `lib/dic/e164.ts` — E.164 normalization (country + raw phone)
- Ingest: `lib/ingest/process-call-event.ts` (writes `user_agent`, `phone_source_type`; raw phone is stored verbatim for later normalization)

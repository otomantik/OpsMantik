# GDPR Compliance Sprint Hardening PR

## Overview

Post-audit hardening: sync route order, consent source of truth, isolated consent verifier, export scope, unit tests.

## File Diff Summary

### Modified

| File | Change |
|------|--------|
| `app/api/sync/route.ts` | Order: Auth → Parse → validateSite → Rate limit → Consent → Idempotency → Quota → Publish. Site invalid → 400. Consent missing → 204 only when site valid. |
| `app/api/gdpr/consent/route.ts` | Uses `verify_gdpr_consent_signature_v1` (not call-event). Updates `sessions` directly (not `gdpr_consents`). Adds X-Ops-Nonce. Redis nonce replay cache (5 min TTL, fail-closed). |
| `supabase/migrations/20260226000003_gdpr_consents.sql` | Comment: DEPRECATED, use sessions.consent_at/consent_scopes |
| `tests/unit/gdpr-consent-gates.test.ts` | validateSite before consent, consent before tryInsert. Site invalid → 400; consent missing → 204 only when site valid |

### Added

| File | Description |
|------|-------------|
| `supabase/migrations/20260226100000_verify_gdpr_consent_signature_v1.sql` | RPC for consent HMAC. Payload: ts\|nonce\|site_id\|identifier_type\|identifier_value\|scopes_json\|consent_at. Replay: ts ±5 min. |
| `supabase/migrations/20260226100001_export_scope_sessions_events_calls.sql` | Export RPC: sessions, events, calls only. Removes conversations, sales. |
| `lib/security/verify-gdpr-consent-signature-v1.ts` | TS wrapper for consent RPC verifier |

## Migration Order

```
20260219100000  audit_log_g5.sql            (audit_log table)
20260226000006  audit_triggers_low_volume   (depends on audit_log)
20260226100000  verify_gdpr_consent_signature_v1
20260226100001  export_scope_sessions_events_calls
```

## Sync Route Flow

```
1. Auth (CORS)
2. Parse body + batch unwrap
3. Request validation (parseValidIngestPayload)
4. Site validation (validateSiteFn)  → invalid: 400
5. Rate limit (siteId:clientId)      → 429
6. Consent gate (analytics)          → missing: 204 + x-opsmantik-consent-missing
7. Idempotency (tryInsert)
8. Quota
9. Publish
```

## Consent Route Logic

- **Auth**: `verify_gdpr_consent_signature_v1` with headers X-Ops-Site-Id, X-Ops-Ts, X-Ops-Nonce, X-Ops-Signature
- **Replay**: Redis nonce cache (key: siteId:ts:nonce, TTL 5 min). Same nonce twice → 401. fail-closed on Redis error
- **Body**: identifier_type, identifier_value, scopes, (optional) consent_at
- **Write**: UPDATE sessions SET consent_at, consent_scopes WHERE site_id AND (fingerprint=… OR id=…)
- **No**: gdpr_consents write

## Export RPC Summary

- **Returns**: sessions, events, calls
- **Excluded**: conversations, sales (subject binding not defined)

## Unit Tests

- `validateSite before consentScopes, consentScopes before tryInsert`
- `Site invalid returns 400, consent missing returns 204 only when site valid`
- OCI marketing consent, Erase partition-key checks unchanged

## Validation Checklist

- [x] No consent bypass
- [x] Idempotency untouched on consent fail
- [x] OCI respects marketing scope
- [x] Erase does not break billing
- [x] No raw PII in audit_log
- [x] No triggers on sessions/events/calls
- [x] Partition keys unchanged

## Smoke Test

```bash
# Sync: site invalid → 400
curl -X POST "$BASE/api/sync" -H "Content-Type: application/json" -d '{"s":"invalid-site","ec":"pv","ea":"view",...}'

# Sync: valid site, no consent → 204
curl -X POST "$BASE/api/sync" -H "Content-Type: application/json" -d '{"s":"VALID_SITE_ID","ec":"pv","ea":"view",...}'
# Expect: 204, x-opsmantik-consent-missing: analytics

# Sync: valid site, consent → 200
curl -X POST "$BASE/api/sync" -H "Content-Type: application/json" -d '{"s":"VALID_SITE_ID","ec":"pv","ea":"view","consent_scopes":["analytics"],...}'
# Expect: 200
```

## Rollback Notes

1. Revert consent route to use `gdpr_consents` and `verify_call_event_signature_v1` if needed
2. Revert export RPC to include conversations/sales: restore `20260226000004_export_pii_rpc.sql` body
3. Revert sync order: rate limit before validateSite, consent before validateSite (old order)
4. Migrations 20260226100000 and 20260226100001 can be left in place; RPCs are backward-compatible

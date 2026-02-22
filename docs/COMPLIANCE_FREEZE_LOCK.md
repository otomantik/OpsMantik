# GDPR Compliance Freeze Lock

**Scope:** Backend + DB only. No UI. No features.  
**Objective:** Lock down GDPR compliance layer to prevent regression or architectural drift.

---

## Frozen Invariants

| # | Invariant | Enforcement |
|---|-----------|-------------|
| 1 | `validateSiteFn` runs **before** consent gate | `tests/unit/compliance-freeze.test.ts` |
| 2 | Consent gate runs **before** idempotency | `tests/unit/compliance-freeze.test.ts` |
| 3 | Idempotency never runs when consent fails (204) | Source order + test |
| 4 | `offline_conversion_queue` write requires marketing consent | `hasMarketingConsentForCall` in enqueue + pipeline |
| 5 | No DELETE on sessions/events/calls (erase uses UPDATE only) | Erase RPC + test |
| 6 | No audit triggers on sessions/events/calls | Migration scan + trigger guard query |
| 7 | Erase does not modify partition keys (created_month, session_month) | Erase RPC + test |
| 8 | Erase preserves billing fields (value_cents, session_id, billable) | Erase RPC + test |
| 9 | audit_log payload must NOT contain: identifier_value, fingerprint, gclid, phone_number | Source scan + test |

---

## Forbidden Changes

- **Sync route:** Reordering consent, validateSite, or idempotency.
- **Erase RPC:** Adding DELETE; modifying created_month, session_month, value_cents, session_id, billable.
- **Triggers:** Creating `audit_*` triggers on `sessions`, `events`, or `calls`.
- **audit_log:** Inserting PII (identifier_value, fingerprint, gclid, phone_number) into payload.
- **OCI enqueue:** Bypassing `hasMarketingConsentForCall`.

---

## Migration Order Dependency

```
20260219100000  audit_log_g5.sql          ← audit_log table must exist first
20260226000006  audit_triggers_low_volume ← uses audit_log; NO triggers on sessions/events/calls
20260226100000  verify_gdpr_consent_signature_v1
20260226100001  export_scope_sessions_events_calls
```

---

## Consent Execution Order Diagram

```
POST /api/sync
    │
    ├─ 1. Auth (CORS)
    ├─ 2. Parse body
    ├─ 3. Request validation
    ├─ 4. validateSiteFn(body.s)     ← MUST run first
    │       └─ invalid → 400
    ├─ 5. Rate limit
    ├─ 6. Consent gate               ← MUST run after validateSite, before idempotency
    │       └─ analytics missing → 204 (idempotency NOT touched)
    ├─ 7. Idempotency (tryInsert)
    ├─ 8. Quota
    └─ 9. Publish
```

---

## Trigger Guard SQL (pg_trigger)

```sql
SELECT t.tgname AS trigger_name, c.relname AS table_name
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE n.nspname = 'public'
  AND c.relname IN ('sessions', 'events', 'calls')
  AND NOT t.tgisinternal
  AND t.tgname LIKE 'audit_%';
```

**Expected:** 0 rows. Any row = compliance violation.

---

## CODEOWNERS

The following paths require review for compliance changes:

- `/app/api/sync/`
- `/app/api/gdpr/`
- `/supabase/migrations/*gdpr*`
- `/supabase/migrations/*audit*`
- `/lib/security/verify-gdpr-consent-signature-v1.ts`
- `/lib/gdpr/`
- `/lib/audit/`

---

## Rollback Notes

1. Revert sync route comment and order → restore prior flow (consent before validateSite invalidates freeze).
2. Remove `tests/unit/compliance-freeze.test.ts` → lose regression protection.
3. Remove `.github/CODEOWNERS` → lose mandatory review on compliance paths.
4. Do **not** revert migrations; schema changes require separate migration.

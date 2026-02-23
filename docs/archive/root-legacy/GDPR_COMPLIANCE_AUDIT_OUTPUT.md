# GDPR Compliance — Principal Audit Output

**Scope:** Backend engine + database only. No UI, cookie banner, legal copy.

---

## 1) File Diff Summary

| File | Change |
|------|--------|
| `supabase/migrations/20260226000000_gdpr_consent_columns.sql` | ADD consent_at, consent_scopes to sessions, events |
| `supabase/migrations/20260226000001_gdpr_erase_requests.sql` | CREATE gdpr_erase_requests |
| `supabase/migrations/20260226000002_erase_pii_rpc.sql` | CREATE erase_pii_for_identifier RPC |
| `supabase/migrations/20260226000003_gdpr_consents.sql` | CREATE gdpr_consents table |
| `supabase/migrations/20260226000004_export_pii_rpc.sql` | CREATE export_data_for_identifier RPC |
| `supabase/migrations/20260226000005_confirm_sale_marketing_consent.sql` | ALTER confirm_sale_and_enqueue — marketing consent check |
| `supabase/migrations/20260226000006_audit_triggers_low_volume.sql` | CREATE audit_table_change + triggers |
| `supabase/migrations/20260226000007_consent_retention_cleanup.sql` | CREATE anonymize_consent_less_data RPC |
| `app/api/sync/route.ts` | + Consent check BEFORE idempotency; 204 + header when analytics missing |
| `app/api/sync/worker/route.ts` | + consent_scopes passed to SessionService, EventService |
| `app/api/gdpr/erase/route.ts` | NEW — POST erase, auth, rate limit, gdpr_erase_requests, audit_log |
| `app/api/gdpr/consent/route.ts` | NEW — POST consent, HMAC, rate limit |
| `app/api/gdpr/export/route.ts` | NEW — GET export, auth, rate limit, audit_log |
| `app/api/cron/gdpr-retention/route.ts` | NEW — POST retention cron |
| `lib/gdpr/consent-check.ts` | NEW — hasMarketingConsentForCall |
| `lib/oci/enqueue-seal-conversion.ts` | + marketing consent check before insert |
| `lib/services/pipeline-service.ts` | + marketing consent check before OCI insert |
| `lib/services/session-service.ts` | + consent_at, consent_scopes in createSession |
| `lib/services/event-service.ts` | + consent_at, consent_scopes in createEvent |
| `lib/types/ingest.ts` | + consent_scopes in IngestMeta |

---

## 2) SQL Migrations (in order)

Run: `supabase db push` or apply via SQL Editor in order.

```
20260226000000_gdpr_consent_columns.sql
20260226000001_gdpr_erase_requests.sql
20260226000002_erase_pii_rpc.sql
20260226000003_gdpr_consents.sql
20260226000004_export_pii_rpc.sql
20260226000005_confirm_sale_marketing_consent.sql
20260226000006_audit_triggers_low_volume.sql
20260226000007_consent_retention_cleanup.sql
```

---

## 3) Route Logic Summary

### POST /api/sync
- **Order:** Auth (CORS) → Rate limit → Parse → **Consent** → Site validate → Idempotency → Quota → Publish
- **Consent:** If `analytics` not in consent_scopes (body.consent_scopes or body.meta.consent_scopes): return 204, header `x-opsmantik-consent-missing: analytics`. No idempotency, no publish.

### POST /api/gdpr/erase
- Auth: validateSiteAccess. Rate limit: 10/hr per site+user. Calls erase_pii_for_identifier, inserts gdpr_erase_requests, audit_log ERASE.

### POST /api/gdpr/consent
- Auth: HMAC (verify_call_event_signature_v1). Rate limit: 10/hr per identifier, 60/hr per IP. Upserts gdpr_consents.

### GET /api/gdpr/export
- Auth: validateSiteAccess. Rate limit: 10/hr. Calls export_data_for_identifier, audit_log EXPORT.

### OCI enqueue (enqueueSealConversion, PipelineService, confirm_sale_and_enqueue)
- Before insert into offline_conversion_queue: check session consent_scopes includes `marketing`. Skip enqueue if not.

---

## 4) Unit Test Cases

| Test | File | Assertion |
|------|------|-----------|
| Consent before idempotency | revenue-kernel-gates.test.ts | consent check index < tryInsert index |
| No bypass: analytics missing returns 204 | (add) | POST sync without consent_scopes → 204, x-opsmantik-consent-missing |
| Idempotency untouched when 204 | (add) | mock tryInsert not called when consent returns 204 |
| OCI marketing skip | (add) | hasMarketingConsentForCall false → enqueueSealConversion returns enqueued: false |
| Erase RPC preserves billing | (add) | sessions: value_cents, event_count, total_duration_sec unchanged |
| Audit log no PII | audit-log.test.ts | payload contains only counts, no identifier_value |

**Add to `tests/unit/gdpr-consent-gates.test.ts`:**

```ts
// Consent check before idempotency
assert.ok(src.indexOf('consentScopes') < src.indexOf('tryInsert(siteIdUuid'));
// 204 path before site resolution
assert.ok(src.indexOf("'x-opsmantik-consent-missing'") < src.indexOf('validateSiteFn'));
```

---

## 5) Integration Test Cases

| Test | Description |
|------|-------------|
| Sync no consent → 204 | POST /api/sync with valid payload, no consent_scopes → 204, no idempotency row |
| Sync with analytics → 200 | POST /api/sync with consent_scopes: ['analytics'] → 200, worker receives job |
| Erase → PII nulled | POST /api/gdpr/erase → verify sessions/events/calls PII columns NULL/redacted |
| Export → JSON shape | GET /api/gdpr/export?site_id=&identifier_type=&identifier_value= → sessions, events, calls, conversations, sales |
| OCI marketing skip | Seal call with session consent_scopes = [] → oci_enqueued: false |

---

## 6) Smoke Test Script

```bash
# scripts/smoke/gdpr-compliance.mjs
# 1. POST /api/sync without consent → expect 204, header x-opsmantik-consent-missing
# 2. POST /api/sync with consent_scopes: ['analytics'] → expect 200
# 3. POST /api/gdpr/erase (auth required) → expect 200, request_id
# 4. GET /api/gdpr/export (auth required) → expect 200, data.sessions, data.events
# 5. POST /api/cron/gdpr-retention (cron auth) → expect 200, sessions_affected, events_affected
```

---

## 7) Rollback Instructions

| Step | Action |
|------|--------|
| 1 | Revert app/api/sync/route.ts consent block (remove 2.4, restore flow to idempotency) |
| 2 | Revert app/api/sync/worker consent_scopes pass-through |
| 3 | Revert lib/services/session-service, event-service consent fields |
| 4 | Revert lib/oci/enqueue-seal-conversion, pipeline-service marketing check |
| 5 | Remove app/api/gdpr/* routes |
| 6 | Remove app/api/cron/gdpr-retention |
| 7 | Drop triggers: audit_provider_credentials, audit_site_members, audit_site_plans, audit_conversations, audit_sales |
| 8 | Drop functions: audit_table_change, erase_pii_for_identifier, export_data_for_identifier, anonymize_consent_less_data |
| 9 | Revert confirm_sale_and_enqueue to prior version |
| 10 | Drop tables: gdpr_erase_requests, gdpr_consents |
| 11 | ALTER sessions, events DROP COLUMN consent_at, consent_scopes (requires new partitions handling) |

**Note:** Dropping consent columns on partitioned tables is complex; prefer leaving columns and disabling logic.

---

## 8) Go/No-Go Checklist

| # | Check | Status |
|---|-------|--------|
| 1 | No code path bypasses consent | ✅ Sync is single ingress; consent before idempotency |
| 2 | Idempotency untouched when analytics missing | ✅ 204 return before tryInsert |
| 3 | OCI enqueue respects marketing scope | ✅ enqueueSealConversion, PipelineService, confirm_sale_and_enqueue |
| 4 | Erase does not break billing aggregation | ✅ Only PII nulled; value_cents, billable, idempotency intact |
| 5 | audit_log does not store raw PII | ✅ payload: counts, identifier_type; no identifier_value |
| 6 | RLS still enforced | ✅ No RLS changes; service_role for admin paths |
| 7 | No hard deletes sessions/events/calls | ✅ Erase uses UPDATE only |
| 8 | No triggers on sessions, events, calls | ✅ Triggers only on low-volume tables |
| 9 | DLQ/fallback payload full replace | ✅ v_redacted JSONB |
| 10 | No partition key modification | ✅ Erase updates non-partition columns only |

---

## Spec Compliance (Post-Remediation)

| Spec | Status |
|------|--------|
| sessions: city, district | ✅ Added to erase RPC |
| calls: click_id, intent_page_url | ✅ Added to erase RPC |
| offline_conversion_queue by call_id | ✅ Erase nulls gclid/wbraid/gbraid for call_id rows |

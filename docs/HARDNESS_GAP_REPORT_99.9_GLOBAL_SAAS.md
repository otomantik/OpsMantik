# Hardness Gap Report: Code-Level Integrity Audit for Global SaaS (99.9% Target)

**Mission:** Deep architectural audit of OpsMantik core engine layers. Identify every ORANGE (unstable under stress) and RED (single-point-of-failure) gap that prevents 99.9% reliability for Global SaaS scale.

**Audit Date:** 2026-02-25

---

## Executive Summary

| Layer | RED Count | ORANGE Count | Status |
|-------|-----------|--------------|--------|
| 1. Data Integrity & Tracking | 0 | 2 | ORANGE |
| 2. Vantablack (Attack Prevention) | 2 | 1 | CRITICAL |
| 3. Hardware & Infrastructure | 0 | 2 | ORANGE |
| 4. Global SaaS Preparedness | 0 | 1 | ORANGE |

**Critical:** Sync route and customer invite use **fail-open** rate limiting. Under Redis outage + bot flood, 100% of requests pass through. No fraud quarantine layer exists.

---

## 1. Data Integrity & Tracking (The Observer)

### 1.1 GCLID/WBRAID Leakage

**Flow:** Sync route → QStash → Ingest worker → `processSyncEvent` → SessionService (gclid/wbraid/gbraid) → DB.

| Finding | Severity | File:Line | Detail |
|---------|----------|-----------|--------|
| Malformed URL throws before GCLID persisted | **ORANGE** | `lib/ingest/process-sync-event.ts:135, 154` | `new URL(url)` can throw (e.g. `url = "::::"` or exotic Unicode from global ad networks). If GCLID exists only in `meta.gclid` but URL is invalid, we throw at L135 before `currentGclid = params.get('gclid') || meta?.gclid` (L156). Event fails, retries indefinitely, never persisted. Click-ID lost. **Fix:** Try/catch around URL parse; if invalid, derive `currentGclid` from `meta?.gclid` only and use a safe fallback URL for session/event. |
| Sync route spreads full payload including meta | **OK** | `app/api/sync/route.ts` | Spreads `...b` (full payload) to QStash. Worker receives `meta.gclid`, `meta.wbraid`, `meta.gbraid`. No leak in sync→worker handoff. |
| SessionService dual-sources GCLID | **OK** | `lib/services/session-service.ts:98-110` | `params.get('gclid') || meta?.gclid`; URL params + meta both used. IntentService L56-60 same. |

### 1.2 Idempotency

| Finding | Severity | File:Line | Detail |
|---------|----------|-----------|--------|
| processed_signals dedup | **OK** | `lib/ingest/process-sync-event.ts:90-101` | `event_id = SHA256(qstashMessageId|fallback_key)`. 23505 → DedupSkipError, ack 200. No duplicate records. |
| ingest_idempotency | **OK** | `lib/idempotency.ts:259-296` | `tryInsertIdempotencyKey`; 23505 → `duplicate: true`, return 200 dedup. No duplicate billing rows. |
| calls UNIQUE (site_id, intent_stamp) | **OK** | `supabase/migrations/20260227150000_restore_calls_site_intent_stamp_uniq.sql` | Restored; `ensure_session_intent_v1` ON CONFLICT works. |

### 1.3 Edge-Case Validation (Malformed JSON / Unexpected Chars)

| Finding | Severity | File:Line | Detail |
|---------|----------|-----------|--------|
| req.json() throws → 400 invalid_json | **OK** | `app/api/sync/route.ts`, `app/api/workers/ingest/route.ts` | Catch block returns 400. No crash. |
| parseValidIngestPayload robust | **OK** | `lib/types/ingest.ts` | `asMeta`, `normalizeUrl`, truncation. Non-object meta → undefined; meta normalized. |
| No control-char sanitization | **ORANGE** | `lib/types/ingest.ts:154-159` | `normalizeUrl` uses `String(url).trim()` and `truncate`. Control chars (e.g. `\0`, `\b`) can pass through to DB. Low impact (Postgres tolerates) but could affect downstream consumers. **Fix:** Strip control chars before truncation. |
| Worker invalid payload acked | **OK** | `app/api/workers/ingest/route.ts:72-73` | `parsed.kind !== 'ok'` → return 200, drop message. No retry storm. |

---

## 2. The Vantablack Shield (Attack Prevention)

### 2.1 Bot Infiltration

| Finding | Severity | File:Line | Detail |
|---------|----------|-----------|--------|
| Sync route uses fail-open | **RED** | `app/api/sync/route.ts:186, 253` | `RateLimitService.check(...)` defaults to `mode: 'fail-open'`. On Redis error → `allowed: true`. **10,000 bots in 1 second + Redis down = all pass.** No fail-safe. |
| RateLimitService default | **RED** | `lib/services/rate-limit-service.ts:37, 72-73, 106` | `opts?.mode ?? 'fail-open'`; catch block returns `{ allowed: true }`. `check()` calls `checkWithMode` with fail-open. |
| Customer invite fail-open | **RED** | `app/api/customers/invite/route.ts:118, 136` | Uses `RateLimitService.check()` (fail-open). Abuse path if Redis down. |
| call-event uses degraded | **OK** | `app/api/call-event/route.ts:99, 389, 410` | `mode: 'degraded'` → local fallback with lower limits. |
| GDPR / OCI export/ack use fail-closed | **OK** | `app/api/gdpr/export/route.ts:64`, `oci/export-batch/route.ts:29`, `oci/google-ads-export/route.ts:57` | `mode: 'fail-closed'`. |

### 2.2 Fingerprint Logic

| Finding | Severity | File:Line | Detail |
|---------|----------|-----------|--------|
| No bot-specific fingerprint validation | **ORANGE** | `lib/ingest/process-sync-event.ts`, `lib/services/session-service.ts` | Fingerprint used for session matching only. Bots can send arbitrary `meta.fp`. No anomaly/fraud fingerprint checks. |

### 2.3 Silent Poisoning (Toxic Data Quarantine)

| Finding | Severity | File:Line | Detail |
|---------|----------|-----------|--------|
| No fraud quarantine layer | **RED** | — | `ingest_fallback_buffer` = QStash failure durability, not fraud. `ingest_publish_failures` = logging. High-frequency fraud (same fingerprint, 1000 events/min) passes rate limit (when Redis works) and goes straight to `sessions`, `events`, `calls`. **No quarantine table.** Toxic data hits primary tables. **Fix:** Add `ingest_fraud_quarantine` or equivalent; route high-frequency/suspicious events there; never write to Calls/Conversions until manually reviewed. |

---

## 3. Hardware & Infrastructure Realism (Reele İndirgeme)

### 3.1 Cold-Start Latency / P0 Retries

| Finding | Severity | File:Line | Detail |
|---------|----------|-----------|--------|
| P0 12/12 retries root cause | **OK** | Historical | Fixed: (1) Sync timeout 5s→15s (`lib/tracker/transport.js`), (2) calls UNIQUE constraint restored, (3) consent_scopes in P0 payload. |
| No explicit TTFB/ cold-start metric | **ORANGE** | `app/api/workers/ingest/route.ts` | Vercel serverless cold start 1–5s. No `Date.now()` at handler start to measure TTFB. **Fix:** Add timing header `x-opsmantik-worker-ttfb-ms` for observability. |
| Heavy read cold start | **ORANGE** | `app/api/reporting/dashboard-stats/route.ts` | `tryAcquireHeavyRead` + RPC; cold start not measured. |

### 3.2 Concurrency & Locking

| Finding | Severity | File:Line | Detail |
|---------|----------|-----------|--------|
| claim_offline_conversion_jobs FOR UPDATE SKIP LOCKED | **OK** | `supabase/migrations/20260218100000_conversation_layer_rpc_security_hardening.sql:183-184` | 1000 clients claim different rows; no cross-blocking. |
| apply_call_action_v1 FOR UPDATE | **OK** | `supabase/migrations/20260326000000_sprint1_state_machine_lockdown.sql:48-49` | Locks single call row. Different calls = different rows = no blocking. |
| usage_counters / site_usage_monthly FOR UPDATE | **OK** | `supabase/migrations/20260302000000_sprint1_subscriptions_usage_entitlements.sql:322-323` | Per-site lock. High concurrency on same site could serialize; acceptable. |
| ensure_session_intent_v1 | **OK** | `supabase/migrations/20260227150000_restore_calls_site_intent_stamp_uniq.sql` | UNIQUE (site_id, intent_stamp); ON CONFLICT DO NOTHING. No blocking between different intent_stamps. |

---

## 4. Global SaaS Preparedness

### 4.1 Timezone / Localization

| Finding | Severity | File:Line | Detail |
|---------|----------|-----------|--------|
| today-range strictly timezone-aware | **OK** | `lib/time/today-range.ts` | `getTodayDateKey(timezone)`, `dateKeyToUtcRange(dateKey, timezone)` use `Intl.DateTimeFormat` + IANA. Default `Europe/Istanbul`. Tokyo vs NYC: different timezones → different "today" ranges. Correct. |
| get_dashboard_stats uses p_days | **OK** | `supabase/migrations/20260127013000_dashboard_stats_rpc_final.sql:4-16` | `v_start_date := NOW() - (p_days || ' days')::interval`. Rolling window; client passes date_from/date_to for "today" via timezone. |
| created_at timestamptz | **OK** | Schema | UTC stored. Display layer handles local. |

### 4.2 Multi-Tenancy Security (RLS)

| Finding | Severity | File:Line | Detail |
|---------|----------|-----------|--------|
| get_dashboard_stats SECURITY INVOKER | **OK** | `supabase/migrations/20260127013000_dashboard_stats_rpc_final.sql:7` | RLS on calls/sessions/events applies. Client A passing Client B's site_id → RLS returns 0 rows (not member). Empty result, no leak. |
| validateSiteAccess before RPC | **OK** | `app/api/reporting/dashboard-stats/route.ts`, `lib/security/validate-site-access.ts` | API validates site membership before `get_dashboard_stats`. |
| TenantClient enforces site_id | **OK** | `lib/supabase/tenant-client.ts:26-31, 55-59, 68-72` | RPC/insert/select enforce `site_id`; override blocked. |
| RLS policies use site_members | **OK** | `supabase/migrations/20260130210000_go21_seal_rls_oci_status.sql`, `20260209090000_rbac_v2_site_member_roles.sql` | calls/sessions/events select/update scoped by owner or site_members. |

---

## 5. Hardness Gap Summary (File:Line)

### RED (Must Fix for 99.9%)

| # | File | Line(s) | Issue |
|---|------|---------|-------|
| 1 | `app/api/sync/route.ts` | 186, 253 | Rate limit fail-open; switch to `fail-closed` or `degraded` for sync. |
| 2 | `lib/services/rate-limit-service.ts` | 37, 72-73, 106 | Default fail-open; consider env-driven default or fail-closed for critical paths. |
| 3 | `app/api/customers/invite/route.ts` | 118, 136 | Rate limit fail-open; use `fail-closed` or `degraded`. |
| 4 | — | — | No fraud quarantine layer; toxic data hits Calls/Conversions. |

### ORANGE (Should Fix)

| # | File | Line(s) | Issue |
|---|------|---------|-------|
| 1 | `lib/ingest/process-sync-event.ts` | 135, 154 | `new URL(url)` throws on malformed URL; wrap in try/catch, fallback to meta.gclid. |
| 2 | `lib/types/ingest.ts` | 154-159 | Add control-char sanitization in normalizeUrl. |
| 3 | `app/api/workers/ingest/route.ts` | — | Add TTFB timing header for cold-start observability. |
| 4 | `lib/ingest/process-sync-event.ts`, session/event flow | — | No bot/fraud fingerprint checks. |
| 5 | `app/api/reporting/dashboard-stats/route.ts` | 40, 148-151 | `tryAcquireHeavyRead` fail-open on Redis error; noisy neighbor under outage. |

---

## 6. Recommended Fix Order

1. **RED-1,2,3:** Sync + invite + default: Use `fail-closed` or `degraded` for ingest/critical paths. Add `OPSMANTIK_RATE_LIMIT_FAIL_MODE` env.
2. **RED-4:** Design and add `ingest_fraud_quarantine` + routing logic for high-frequency/suspicious events.
3. **ORANGE-1:** Malformed URL handling in process-sync-event.
4. **ORANGE-2:** Control-char sanitization in ingest types.
5. **ORANGE-3,5:** TTFB headers + heavy-read fail mode.

---

## 7. Implemented Fixes (CRITICAL LOCKDOWN Sprint)

| Fix | File | Status |
|-----|------|--------|
| Fail-closed sync route | `app/api/sync/route.ts:186, 253` | ✅ Uses `checkWithMode(..., { mode: 'fail-closed' })` |
| Fail-closed default | `lib/services/rate-limit-service.ts:37, 106` | ✅ Default `fail-closed`; env `OPSMANTIK_RATE_LIMIT_FAIL_MODE` override |
| Fraud quarantine table | `supabase/migrations/20260225160000_ingest_fraud_quarantine.sql` | ✅ Created |
| Fraud quarantine routing | `app/api/workers/ingest/route.ts`, `lib/services/fraud-quarantine-service.ts` | ✅ High-frequency fingerprint → ingest_fraud_quarantine |
| Robust URL parsing | `lib/ingest/process-sync-event.ts:135-160` | ✅ try/catch around `new URL(url)`; fallback to meta.gclid, safeUrl |

**Next Step:** Apply migration `npx supabase db push --include-all`. Re-audit ORANGE items in next sprint.

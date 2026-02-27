# OpsMantik Global SaaS Readiness Audit (ReportBot)

**Date:** 2026-02-25  
**Repo Commit:** `b3067afe799897c320efd85ea2eec7f763af0284`  
**Scope:** Full codebase (API, migrations, RLS, workers, billing, ingestion, scoring, entitlements, cron, tests, docs). Report-only; no code changes.

---

## Scorecard

| Dimension | Score (0–10) | Notes |
|-----------|--------------|--------|
| **Isolation** | 7 | RLS on core tables; SECURITY DEFINER RPCs enforce site access; service_role intentional. Gaps: test-notification no auth in non-prod; auto-junk filter bug. |
| **Security** | 7 | Cron/auth guards in place; CORS, HMAC, replay cache. Some `as any` / `any` in runner and tests; console.log in prod paths. |
| **Ingestion Durability** | 8 | Idempotency → quota → entitlements order; DLQ + replay; rate limit vs quota headers distinct. Fallback buffer + recovery cron. |
| **Scale Readiness** | 6 | Heavy-read limit (Sprint 3); query timeout helper. Entitlements default to full access in production (no strict DB gates unless env set). |
| **Billing Correctness** | 7 | Invoice freeze, reconciliation SKIP LOCKED, usage_counters + increment_usage_checked. Idempotency retention and header semantics documented. |
| **Entitlements/Modularity** | 6 | active_modules + getEntitlements + requireModule/requireCapability; FeatureGuard UI. Production defaults to PRO_FULL_ENTITLEMENTS unless OPSMANTIK_ENTITLEMENTS_STRICT=true. |
| **Observability** | 7 | Sentry + PII scrub; watchtower; structured logs in places. Some routes lack Sentry tags; alerting completeness not verified in repo. |
| **Developer Velocity** | 7 | 59 unit/integration tests; RLS proof tests; runbooks. Gaps: no e2e for critical paths; some legacy/duplicate routes. |

---

## 🔴 RED (Critical / must fix before scaling or selling)

### RED-1: Auto-junk cron uses Promise as filter value (broken query)

- **Severity:** RED  
- **Evidence:** `app/api/cron/auto-junk/route.ts` lines 13–19: `.lt('expires_at', adminClient.rpc('now'))`. `adminClient.rpc('now')` returns a **Promise**, not a timestamp. The filter value is invalid; the update may match no rows or behave unpredictably.  
- **Risk:** Stale leads are never auto-junked (or wrong rows updated). Operational confusion and data integrity issue.  
- **Fix plan:**  
  1. Use a server-side timestamp: e.g. `new Date().toISOString()` or call an RPC that returns current time and await it before building the query.  
  2. Or use raw SQL / RPC for “update calls set status = 'junk' where status = 'pending' and expires_at < now()” and return count.  
  3. Add a unit test that asserts the update filter uses a resolved timestamp, not a Promise.  
- **Verification:** Run auto-junk in staging with known pending rows with `expires_at` in the past; confirm they transition to `junk`. Check Supabase logs for the actual query.

---

### RED-2: test-notification route has no auth in non-production

- **Severity:** RED  
- **Evidence:** `app/api/cron/test-notification/route.ts` lines 11–15: Auth check only runs when `process.env.NODE_ENV === 'production'`. In development/staging, any caller can trigger Telegram notifications.  
- **Risk:** Abuse in staging (spam, alert fatigue); possible information disclosure if message content is sensitive.  
- **Fix plan:**  
  1. Always require auth: use `requireCronAuth(req)` (or same Bearer CRON_SECRET check) in all environments, or require Bearer in staging as well.  
  2. If manual test is needed in dev, gate behind an explicit env e.g. `ALLOW_CRON_TEST_WITHOUT_SECRET=true` and document.  
- **Verification:** Request GET /api/cron/test-notification without headers in staging → expect 401/403.

---

### RED-3: Production entitlements default to full access (no DB enforcement)

- **Severity:** RED (for “selling” tiered SaaS)  
- **Evidence:** `lib/entitlements/getEntitlements.ts` lines 14–17: `FULL_ACCESS = EXPLICIT_FULL_ACCESS || (IS_PRODUCTION && !STRICT_ENTITLEMENTS)`. In production, unless `OPSMANTIK_ENTITLEMENTS_STRICT=true`, every site gets PRO_FULL_ENTITLEMENTS and subscription/usage limits are not enforced.  
- **Risk:** Cannot sell or enforce paid tiers; all tenants get unlimited usage in prod.  
- **Fix plan:**  
  1. Document current behavior as “launch mode” vs “tiered mode.”  
  2. Introduce a rollout: set `OPSMANTIK_ENTITLEMENTS_STRICT=true` in production when subscriptions are ready, and run subscription/usage backfill.  
  3. Add a startup or watchtower check that logs a warning when in production and STRICT is false (so operators know limits are off).  
- **Verification:** With STRICT=true in staging, call get_entitlements_for_site for a site without subscription → expect FREE_FALLBACK or limited limits; sync over limit → 429.

---

## 🟡 YELLOW (High priority / should fix soon)

### YELLOW-1: call-event routes do not gate on active_modules (e.g. core_oci)

- **Severity:** YELLOW  
- **Evidence:** `app/api/call-event/route.ts` and `app/api/call-event/v2/route.ts`: No call to `requireModule` or `getEntitlements` for a call-event–specific module. Ingest (sync) gates via sync-gates in worker; call-event is separate.  
- **Risk:** If call-event is a paid or modular feature, tenants without the module could still submit call events.  
- **Fix plan:**  
  1. After site resolve, call `getEntitlements(siteId, adminClient)` (or requireModule).  
  2. If the product requires a module (e.g. `core_oci` or `scoring_v1`) for call-event, require it and return 403 with a clear code when missing.  
  3. Document in entitlements which capability/module is required for call-event.  
- **Verification:** With a site that has the module disabled (or missing from active_modules), POST call-event → expect 403 or equivalent.

---

### YELLOW-2: Debug / test routes reachable in production

- **Severity:** YELLOW  
- **Evidence:** `app/api/debug/realtime-signal/route.ts`, `app/api/create-test-site/route.ts`, `app/api/test-oci/route.ts` exist and are part of the API. create-test-site uses RLS; debug and test-oci may expose internal behavior.  
- **Risk:** Information disclosure, test data creation, or abuse if not gated.  
- **Fix plan:**  
  1. Gate debug and test-oci with `NODE_ENV !== 'production'` or an explicit feature flag / allowlist (e.g. admin-only or internal IP). Return 404 or 403 in production.  
  2. Rename or document create-test-site as “dev-only” and disable in production or restrict to a single “sandbox” tenant.  
- **Verification:** In production, GET/POST these paths → expect 404/403 unless explicitly allowed.

---

### YELLOW-3: console.log / console.error in production code paths

- **Severity:** YELLOW  
- **Evidence:** Multiple files: e.g. `lib/auth/is-admin.ts` (line 26), `app/api/cron/watchtower/route.ts` (line 17), `app/api/workers/google-ads-oci/route.ts` (line 28), `lib/oci/runner.ts` (multiple), `lib/services/watchtower.ts`, `app/api/cron/auto-junk/route.ts` (line 24).  
- **Risk:** Log noise, possible PII or secrets in console in serverless; unstandardized observability.  
- **Fix plan:**  
  1. Replace with structured logger (`logInfo`, `logWarn`, `logError`) from `lib/logging/logger.ts` and ensure no PII in messages.  
  2. Add a lint rule to forbid `console.log`/`console.error`/`console.warn` in `app/` and `lib/` (with narrow allowlist if needed).  
- **Verification:** Grep for console\.(log|warn|error); only allowlisted files remain.

---

### YELLOW-4: Type safety gaps (`any`, `as any`) in critical paths

- **Severity:** YELLOW  
- **Evidence:** `lib/valuation/predictive-engine.ts` line 33 (`weights: any`); `lib/oci/runner.ts` lines 403, 421 (`siteValuation` as any / intent_weights any); `app/api/workers/calc-brain-score/route.ts` line 78 (`(brainBreakdown as any).version`); `app/api/oci/google-ads-export/route.ts` lines 73, 81 (site type with `intent_weights?: any`); `lib/cron/process-offline-conversions.ts` line 46 (`(row as any).action_key`); `tests/billing/financial-proofing.test.ts` line 34 (`admin as any`).  
- **Risk:** Payload poisoning or runtime errors when shape changes; harder to refactor.  
- **Fix plan:**  
  1. Define proper types or Zod schemas for `intent_weights`, `siteValuation`, and score breakdown version; infer types from Zod where applicable.  
  2. Replace `as any` with type guards or narrow types.  
  3. Restrict `any` in new code via tsconfig strictness or eslint.  
- **Verification:** Run tsc and lint; no new `any` in these files; unit tests still pass.

---

### YELLOW-5: Cron test-notification does not accept x-vercel-cron

- **Severity:** YELLOW  
- **Evidence:** `app/api/cron/test-notification/route.ts`: Only checks `Authorization: Bearer ${CRON_SECRET}`. Other cron routes use `requireCronAuth`, which accepts `x-vercel-cron: 1`. test-notification is not in vercel.json crons; if it were, Vercel would send x-vercel-cron and the route would reject (no Bearer).  
- **Risk:** Inconsistent cron auth; manual runs must use Bearer.  
- **Fix plan:** Use `requireCronAuth(req)` in test-notification so it accepts both x-vercel-cron and Bearer CRON_SECRET.  
- **Verification:** Call with `x-vercel-cron: 1` → 200 when cron is allowed; without auth → 403.

---

### YELLOW-6: auto-junk not in vercel.json and uses QStash-only auth

- **Severity:** YELLOW  
- **Evidence:** `vercel.json` lists 9 crons; auto-junk is not among them. `app/api/cron/auto-junk/route.ts` uses `requireQstashSignature(handler)`.  
- **Risk:** If auto-junk is intended to run on a schedule, it must be triggered by an external scheduler (e.g. QStash cron). If that is not configured, stale leads never get auto-junked.  
- **Fix plan:**  
  1. Either add auto-junk to vercel.json (e.g. daily) and change the route to use `requireCronAuth` instead of QStash (or support both), or  
  2. Document that auto-junk is QStash-triggered only and add a runbook to configure QStash schedule.  
  3. Fix the .lt('expires_at', ...) bug (RED-1) regardless.  
- **Verification:** After fix, either Vercel cron or QStash triggers auto-junk and pending rows with past expires_at become junk.

---

## 🔵 BLUE (Good / implemented but needs hardening or proof)

### BLUE-1: RLS and SECURITY DEFINER RPCs

- **Evidence:** Core tables (sites, sessions, events, calls, profiles, site_members, conversations, sales, offline_conversion_queue, etc.) have RLS enabled. Many RPCs are SECURITY DEFINER and enforce `can_access_site` / `is_admin` / service_role.  
- **Risk:** Minor: some RPCs grant anon/authenticated; need to ensure no RPC returns cross-tenant data.  
- **Fix plan:** Audit every RPC that is granted to anon/authenticated for correct site_id scoping; document service_role-only RPCs.  
- **Verification:** RLS proof tests; run tenant-rls-proof and add a test that lists all RPCs and their grants.

---

### BLUE-2: Ingestion order (consent → idempotency → publish; worker: idempotency → quota → entitlements)

- **Evidence:** Sync route: consent check before idempotency key computation and publish. Worker: runSyncGates does idempotency tryInsert → quota → increment_usage_checked (entitlements).  
- **Risk:** Duplicate path must never publish (proven in tests); order is correct in code.  
- **Fix plan:** Add an integration test that asserts: duplicate sync (same idempotency key) returns 200 + x-opsmantik-dedup and no new row in ingest_idempotency and no QStash publish.  
- **Verification:** Test in staging: two identical sync bodies → second returns 200 dedup and no double insert.

---

### BLUE-3: Conversion pipeline (Iron Dome): SKIP LOCKED, claiming, retries

- **Evidence:** `claim_offline_conversion_jobs_v2` uses FOR UPDATE SKIP LOCKED; `lib/oci/runner.ts` uses MAX_RETRY_ATTEMPTS (7); backoff and isFinal logic present.  
- **Risk:** Stuck jobs (PROCESSING forever) if worker crashes; recovery RPC exists but scheduling is external.  
- **Fix plan:** Document max retries and recovery cron (recover-processing); consider a “stale PROCESSING” re-queue after N minutes in a migration or cron.  
- **Verification:** Unit tests reference SKIP LOCKED and MAX_RETRY_ATTEMPTS; run process-offline-conversions in staging and confirm FAILED after 7 retries.

---

### BLUE-4: Billing: invoice freeze, reconciliation jobs, usage_counters

- **Evidence:** invoice-freeze cron; billing_reconciliation_jobs with SKIP LOCKED; usage_counters + increment_usage_checked (service_role only).  
- **Risk:** Idempotency key retention and invoice snapshot semantics must match business rules.  
- **Fix plan:** Document retention period for ingest_idempotency and invoice_snapshot; add a test that asserts invoice freeze does not overwrite in an unexpected way.  
- **Verification:** Lifecycle test and reconciliation test pass; run invoice-freeze with dry_run and verify SQL behavior.

---

### BLUE-5: Observability (Sentry, PII scrub, watchtower)

- **Evidence:** Sentry with beforeSend PII scrubbing (lib/security/sentry-pii.ts); watchtower with ingestPublishFailuresLast15m; build-info headers on key routes.  
- **Risk:** Some routes may not set request_id or route tags; alerting may be incomplete outside repo.  
- **Fix plan:** Ensure every API route that can throw sets Sentry tags (route, request_id, site_id where safe); document alerting runbook (Sentry alerts, watchtower → PagerDuty/Telegram).  
- **Verification:** Trigger errors in sync, call-event, seal; confirm Sentry events have tags and no raw PII.

---

### BLUE-6: Heavy-read rate limit and reporting timeout (Sprint 3)

- **Evidence:** `lib/services/rate-limit-service.ts` tryAcquireHeavyRead; `app/api/reporting/dashboard-stats/route.ts` uses it and withQueryTimeout(10s).  
- **Risk:** Dashboard UI may still call Supabase RPC directly and bypass the limit.  
- **Fix plan:** Wire dashboard to GET /api/reporting/dashboard-stats so all heavy reads go through the limit; document in runbook.  
- **Verification:** Load test: 11+ concurrent dashboard-stats requests for same site → 429 for over-limit; ingest unchanged.

---

## 🟢 GREEN (Done / verified, low risk)

- **Multi-tenant RLS:** sites, sessions, events, calls, site_members, and later tables have RLS with auth.uid() or can_access_site pattern; service_role bypass documented.  
- **Sync ingestion:** Rate limit (Redis) → consent → idempotency key → QStash publish; worker runs idempotency, quota, entitlements in correct order; 429 headers (x-opsmantik-ratelimit vs x-opsmantik-quota-exceeded) distinct.  
- **DLQ and replay:** sync_dlq, sync_dlq_record_replay, sync_dlq_replay_audit; replay route requires auth and audits.  
- **Cron auth:** All vercel.json cron routes use requireCronAuth (watchtower, recover, reconcile-usage, idempotency-cleanup, invoice-freeze, process-offline-conversions, recover-processing, dispatch-conversions, sweep-unsent-conversions).  
- **Seal/stage:** validateSiteAccess + hasCapability(role, 'queue:operate'); version column used for optimistic locking; pipeline-service version_mismatch.  
- **Call-event:** Signature verification, replay cache, consent gate; 204 + x-opsmantik-consent-missing when analytics consent missing.  
- **GCLID Phase 2 (Sprint 3):** localStorage clear on organic re-entry; session-service strips gclid/wbraid/gbraid when session is Organic.  
- **AdsContext:** Single Zod schema in call-event-worker-payload; routes use shared AdsContextOptionalSchema.  
- **PII scrubbing:** Sentry beforeSend scrubs IP, fingerprint, phone (sentry-pii.ts).  
- **Tests:** 59 test files; RLS proof, entitlements, revenue-kernel gates, require-cron-auth, sync rate limit, idempotency, call-event consent, quota headers.

---

## Top 10 PR Queue

1. **Fix auto-junk filter (RED-1):** Replace `.lt('expires_at', adminClient.rpc('now'))` with awaited timestamp or RPC; add test.  
2. **Harden test-notification auth (RED-2):** Require cron auth (or Bearer) in all environments; use requireCronAuth.  
3. **Document and optionally enforce entitlements in production (RED-3):** Warning when STRICT=false in prod; runbook for enabling STRICT and backfilling.  
4. **Gate call-event on module/capability (YELLOW-1):** getEntitlements/requireModule after site resolve; 403 when module missing.  
5. **Gate debug/test routes in production (YELLOW-2):** 404/403 for /api/debug/*, /api/test-oci (and optionally create-test-site) when NODE_ENV=production.  
6. **Replace console.* with logger (YELLOW-3):** In app/api, lib/oci, lib/services, lib/auth; add lint rule.  
7. **Remove or narrow `any` in runner and scoring (YELLOW-4):** Type intent_weights, siteValuation, brainBreakdown version.  
8. **Unify test-notification cron auth (YELLOW-5):** Use requireCronAuth so x-vercel-cron is accepted.  
9. **Document auto-junk trigger (YELLOW-6):** Either add to vercel.json + requireCronAuth or document QStash schedule.  
10. **Integration test: duplicate sync never publishes (BLUE-2):** Assert 200 + x-opsmantik-dedup and no second idempotency row and no second publish.

---

## Go/No-Go Gates for Global SaaS Launch

- [ ] **RED items resolved:** Auto-junk query fixed; test-notification auth in all envs; entitlements strategy (strict vs full access) decided and documented.  
- [ ] **Cron execution proof:** All 9 vercel.json crons run on schedule (log or watchtower proof); auto-junk either in Vercel or QStash and runnable.  
- [ ] **No unprotected debug/test routes in production:** /api/debug/*, /api/test-oci return 404/403 in prod unless explicitly allowlisted.  
- [ ] **Entitlements:** If selling tiers, OPSMANTIK_ENTITLEMENTS_STRICT=true in prod and subscriptions/usage_counters populated and tested.  
- [ ] **Observability:** Sentry alerts and watchtower → on-call path documented; PII scrub verified.  
- [ ] **Smoke:** Sync 200/429 (rate limit), duplicate 200 + x-opsmantik-dedup, call-event 204 consent-missing, seal 200 with version, watchtower 200 with build-info headers.

---

## Missing Proofs

- **Staging/prod proof that crons run:** Vercel dashboard or logs showing cron invocations (watchtower, recover, process-offline-conversions, invoice-freeze) at expected intervals.  
- **Proof that auto-junk actually updates rows:** After fixing RED-1, run once in staging with known pending + expired rows and confirm status = 'junk'.  
- **Proof that strict entitlements enforce limits:** With OPSMANTIK_ENTITLEMENTS_STRICT=true, create a site with FREE tier and exceed monthly_revenue_events; expect 429 and x-opsmantik-quota-exceeded.  
- **Proof that duplicate sync never publishes:** Staging test: two identical POST /api/sync; second returns 200 with x-opsmantik-dedup; single row in ingest_idempotency; single QStash message (or equivalent).  
- **Alerting completeness:** Document which Sentry errors and watchtower states trigger alerts and who is paged.

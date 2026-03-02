# Enterprise Test Matrix v1 — OpsMantik

**Context:** Attribution + ingestion SaaS; cron jobs, workers, queue processors, idempotency-based billing, Supabase RLS. Recent: cron GET + distributed locks; site-scoped Ghost Geo, Traffic Debloat, page_view 10s session reuse.

**Constraints:** No UI/i18n changes. No production behavior change from this work (analysis + test plan only). ingest_idempotency = billing SoT; marketing_signals semantics unchanged.

**Test runner:** `node --import tsx --test`; unit suite ~396+ tests (`npm run test:unit`), plus `test:rls`, `test:intent-flow`, `test:ledger`, `test:verify-handshake`, billing tests.

---

## 1. Test inventory and classification

### 1.1 Discovery summary

| Location | Pattern | Count |
|----------|---------|-------|
| `tests/unit/` | `*.test.ts` | 67 files |
| `tests/billing/` | `*.test.ts` | 2 files |
| `tests/rls/` | `*.test.ts` | 1 file |
| `tests/` (root) | `*.test.ts`, `*.spec.ts` | 4 files |

**Total test files:** 70+ (one `dashboard-watchtower.spec.ts`).

### 1.2 Classification by type

- **Unit:** Pure logic, no DB/network; mocks allowed. Examples: `idempotency.test.ts`, `ingest-billable.test.ts`, `geo.test.ts`, `bot-referrer-gates.test.ts`, `normalize-landing-url.test.ts`, `attribution-service.test.ts`, `rate-limit-service.test.ts`, `build-info.test.ts`, `quota.test.ts`, `entitlements-require.test.ts`, `scoring-engine.test.ts`, `compute-score-v1_1.test.ts`, `gclid-utm-template.test.ts`, `conversion-service.test.ts`, `google-ads-adapter.test.ts`, `oci-*.test.ts`, `sync-route-ratelimit.test.ts`, `require-cron-auth.test.ts`, `require-admin.test.ts`, `verify-signed-request.test.ts`, `replay-cache-service.test.ts`, `semaphore.test.ts`, `vault-credentials.test.ts`, `predictive-engine.test.ts`, `conversation-layer-kernel.test.ts`, `primary-source.test.ts`, `site-identifier.test.ts`, `require-module.test.ts`, `audit-log.test.ts`, `auto-junk-route.test.ts`, `i18n.test.ts`, `dispatch-conversions.test.ts`, `conversations-api.test.ts`, `dashboard-spend-route.test.ts`, `sales-api.test.ts`, `enqueue-from-sales.test.ts`, `providers-registry.test.ts`, `tracker-transport-backoff.test.ts`, `providers-worker-loop.test.ts`, `conversion-worker.test.ts`.
- **Integration (DB/RPC):** Hit Supabase or RPCs. Examples: `tests/rls/tenant-rls-proof.test.ts` (anon key + auth), `tests/billing/reconciliation.test.ts` (reconcile cron + backfill), `tests/billing/lifecycle.test.ts`; `reconciliation.test.ts` (unit folder but imports route + admin client).
- **Contract / adapter:** Payload shape, API contract, provider responses. Examples: `call-event-schema-drift.test.ts`, `google-ads-adapter.test.ts` (partial_failure, error codes), `verify-signed-request.test.ts`, `call-event-match-session.test.ts`.
- **Idempotency / dedupe / billing:** Idempotency keys, duplicate handling, billable flag. Examples: `idempotency.test.ts`, `call-event-db-idempotency.test.ts`, `ingest-billable.test.ts`, `revenue-kernel-gates.test.ts`.
- **Concurrency / cron locks:** Lock acquire, release, skip when held. Examples: `cron-vercel-get-handlers.test.ts` (tryAcquireCronLock, releaseCronLock, `skipped: true`, `reason: 'lock_held'`), `semaphore.test.ts`.
- **Failure / retry / resilience:** Redis down, provider errors, fallback. Examples: `sync-worker-redis-resilience.test.ts`, `rate-limit-service.test.ts` (fail-open / fail-closed), `sync-fallback-recover.test.ts`, `google-ads-adapter.test.ts` (provider errors), `sync-route-ratelimit.test.ts`.
- **Security / RLS / multi-tenant:** Tenant scope, RLS, consent. Examples: `tenant-scope-audit.test.ts`, `tests/rls/tenant-rls-proof.test.ts`, `rbac.test.ts`, `require-admin.test.ts`, `call-event-consent-hardening.test.ts`, `gdpr-consent-gates.test.ts`, `compliance-freeze.test.ts`.
- **Observability / telemetry:** Headers, skipped reasons, health. Examples: `watchtower-response.test.ts`, `build-info.test.ts`; compliance-freeze and revenue-kernel-gates assert header/response shape.
- **Business reconciliation:** Billing vs usage, Ads vs sessions. Examples: `tests/billing/reconciliation.test.ts`, `tests/billing/financial-proofing.test.ts`, `reconciliation.test.ts`.
- **Migration / backward-compat / site-scoped flags:** Schema or config backward compat. Examples: `call-event-db-idempotency.test.ts` (migration). **No tests for site-scoped ingest flags** (ghost_geo_strict, traffic_debloat, page_view_10s_session_reuse) or strict-mode-off backward compat.

---

## 2. TEST MATRIX TABLE

| Category | Current coverage | Evidence (test file paths) | Gaps | Risk | Proposed tests | Priority | Notes |
|----------|------------------|----------------------------|------|------|-----------------|----------|--------|
| **Unit** | High | `tests/unit/*.test.ts` (67 files), e.g. `idempotency.test.ts`, `geo.test.ts`, `bot-referrer-gates.test.ts`, `normalize-landing-url.test.ts`, `attribution-service.test.ts`, `quota.test.ts`, `ingest-billable.test.ts` | Few unit tests for `process-sync-event` or worker skip path | Low | Add unit tests for skip-path invariants and 10s reuse (mocked) | P0 (skip path), P1 (reuse) | Already strong |
| **Integration (DB/RPC)** | Med | `tests/rls/tenant-rls-proof.test.ts`, `tests/billing/reconciliation.test.ts`, `tests/billing/lifecycle.test.ts`, `reconciliation.test.ts` | No integration test for getSiteIngestConfig or RPCs used by strict ingest | Med | Optional: getSiteIngestConfig with test site (env-gated) | P2 | RLS tests need env |
| **Contract / adapter** | Med | `call-event-schema-drift.test.ts`, `google-ads-adapter.test.ts`, `verify-signed-request.test.ts`, `call-event-match-session.test.ts` | Worker response contract for skipped + reason (e.g. bot_ua, referrer_blocked) not asserted | Low | Contract test: worker skip response shape | P1 | |
| **Idempotency / billing** | High | `idempotency.test.ts`, `call-event-db-idempotency.test.ts`, `ingest-billable.test.ts`, `revenue-kernel-gates.test.ts` | Skip path: idempotency insert with billable:false and no usage increment not tested | High | Test: when traffic_debloat skip, idempotency row exists with billable=false; increment_usage_checked not called | P0 | Billing SoT |
| **Concurrency / cron locks** | High | `cron-vercel-get-handlers.test.ts` (tryAcquireCronLock, releaseCronLock, skipped + lock_held), `semaphore.test.ts` | Source-only; no runtime test that lock_held returns 200 | Low | Optional: mock cron route call, assert 200 + skipped when lock held | P2 | |
| **Failure / retry** | Med | `sync-worker-redis-resilience.test.ts`, `rate-limit-service.test.ts`, `sync-fallback-recover.test.ts`, `google-ads-adapter.test.ts` | Worker skip path on referrer/bot does not retry; no test for processed_signals terminal status on skip | Med | Test: skip path sets processed_signals to terminal (e.g. skipped) so no retry | P0 | |
| **Security / RLS / multi-tenant** | High | `tenant-scope-audit.test.ts`, `tests/rls/tenant-rls-proof.test.ts`, `rbac.test.ts`, `call-event-consent-hardening.test.ts`, `gdpr-consent-gates.test.ts`, `compliance-freeze.test.ts` | None for site-scoped config (config read by site id only) | Low | None required for matrix v1 | — | |
| **Observability** | Med | `watchtower-response.test.ts`, `build-info.test.ts`, `revenue-kernel-gates.test.ts` (headers) | Skip reason (bot_ua, referrer_blocked) not asserted in response | Low | Assert worker response includes skipped + reason when applicable | P1 | |
| **Business reconciliation** | Med | `tests/billing/reconciliation.test.ts`, `tests/billing/financial-proofing.test.ts`, `reconciliation.test.ts` | No test for “Ads clicks vs sessions” under strict mode (manual/analytics) | Low | P2: document or optional analytics test | P2 | |
| **Migration / site-scoped flags** | Low | `call-event-db-idempotency.test.ts` (migration); no tests for ingest flags | ghost_geo_strict off => no behavior change; traffic_debloat off => no skip; page_view_10s_session_reuse off => no reuse | High | Test: getSiteIngestConfig returns defaults when flags absent; geo/extractGeoInfo without strictGhostGeo unchanged; process-sync-event without flags unchanged | P0 | Back-compat |

---

## 3. Sprintable plan (PRs)

### PR-T1: P0 tests (must-have)

**Goal:** Cover skip-path invariants, valid click-id gating, ghost-geo back-compat, and site-scoped flag “off” behavior so production strict mode can be enabled safely.

| Item | Action | Path | What the test asserts | Runtime |
|------|--------|------|------------------------|---------|
| 1 | Create | `tests/unit/ingest-skip-path-invariants.test.ts` | When worker would skip (bot or referrer_blocked): (1) tryInsertIdempotencyKey is called with billable: false; (2) increment_usage_checked / runSyncGates persist path is not executed for that message; (3) processed_signals receives terminal status (e.g. skipped). Use source inspection and/or mocked worker flow (no real DB). | Quick |
| 2 | Create | `tests/unit/site-ingest-config-flags.test.ts` | getSiteIngestConfig(siteId) when site has no config or empty config returns object with undefined/false for ghost_geo_strict, traffic_debloat, page_view_10s_session_reuse. When config has ingest_strict_mode: true, derived flags true. No Supabase in test (mock or stub getSiteIngestConfig). | Quick |
| 3 | Modify | `tests/unit/geo.test.ts` | Add: with strictGhostGeo false or options omitted, Rome/Amsterdam still returned (already present). Add: extractGeoInfo with meta.city = 'Rome' and strictGhostGeo true => city 'Unknown', district null. | Quick |
| 4 | Create | `tests/unit/process-sync-event-strict-backcompat.test.ts` | Source/behavior: when getSiteIngestConfig returns traffic_debloat false, worker does not run bot/referrer skip path before runSyncGates. When ghost_geo_strict false, process-sync-event does not override geo to Unknown. When page_view_10s_session_reuse false, no 10s session lookup (handleSession path only). Assert via source inspection of `app/api/workers/ingest/route.ts` and `lib/ingest/process-sync-event.ts`. | Quick |
| 5 | Modify | `tests/unit/bot-referrer-gates.test.ts` | Already has hasValidClickId length >= 10. Add: worker or attribution path uses hasValidClickId for Ads attribution when traffic_debloat (source assertion or small unit that process-sync-event attribution override uses hasValidClickId). | Quick |

**Existing files to touch:** `tests/unit/geo.test.ts`, `tests/unit/bot-referrer-gates.test.ts`.

**No flakiness:** No sleeps; use mocks and source assertions; deterministic.

---

### PR-T2: P1 tests

| Item | Action | Path | What the test asserts | Runtime |
|------|--------|------|------------------------|---------|
| 1 | Create | `tests/unit/worker-skip-response-contract.test.ts` | Worker response when skip: body has ok: true, skipped: true, reason: 'bot_ua' or 'referrer_blocked'. Source or mock handler. | Quick |
| 2 | Create | `tests/unit/page-view-10s-reuse.test.ts` | normalizeLandingUrl used in 10s lookup; when page_view_10s_session_reuse true and matching session found, SessionService.handleSession not called (or reuse path taken). Prefer source assertion or mocked process-sync-event with injectable session lookup. No real DB. | Quick |
| 3 | Modify | `tests/unit/revenue-kernel-gates.test.ts` or new | Assert worker when traffic_debloat and skip returns 200 and does not call increment_usage_checked (extend existing gate order test). | Quick |

**Existing files to modify:** `tests/unit/revenue-kernel-gates.test.ts` (optional).

---

### PR-T3: P2 tests

| Item | Action | Path | What the test asserts | Runtime |
|------|--------|------|------------------------|---------|
| 1 | Create | `tests/unit/cron-lock-runtime.test.ts` | Optional: mock tryAcquireCronLock to return lock_held; call cron GET; assert response status 200 and body includes skipped: true, reason: 'lock_held'. No sleep; inject lock result. | Medium |
| 2 | Document or optional | — | Business reconciliation: “Ads clicks ≈ sessions” under strict mode is a product/analytics check; document as manual or dashboard metric. | — |

---

## 4. GO/NO-GO gates for production readiness (strict ingest)

Before enabling site-scoped strict ingest (`ingest_strict_mode: true` or equivalent) on a production site:

1. **All P0 tests pass**
   - `tests/unit/ingest-skip-path-invariants.test.ts` (skip path: idempotency billable:false, no usage increment, processed_signals terminal).
   - `tests/unit/site-ingest-config-flags.test.ts` (flags off => safe defaults).
   - `tests/unit/geo.test.ts` (strictGhostGeo off => back-compat; on => Unknown).
   - `tests/unit/process-sync-event-strict-backcompat.test.ts` (flags off => no skip, no ghost override, no 10s reuse).
   - `tests/unit/bot-referrer-gates.test.ts` (valid click-id len>=10; used in attribution when traffic_debloat).

2. **Existing invariants**
   - `idempotency.test.ts` — idempotency key determinism and duplicate handling.
   - `revenue-kernel-gates.test.ts` — order Auth → Rate limit → Consent → Publish; worker gates before processSyncEvent; quota reject billable=false.
   - `compliance-freeze.test.ts` — consent before publish; no DELETE on sessions/events/calls; audit/erase invariants.
   - `cron-vercel-get-handlers.test.ts` — cron GET/POST, requireCronAuth, tryAcquireCronLock + releaseCronLock, lock_held response.

3. **Acceptance metrics (runtime, not automated in matrix v1)**
   - Bot skip: worker returns 200 with `skipped: true`, `reason: 'bot_ua'`; no new session/event; idempotency row exists with billable false.
   - Referrer block: same with `reason: 'referrer_blocked'` when referrer disallowed and no valid click_id.
   - Valid click-id: gclid/wbraid/gbraid length &lt; 10 does not attribute session to Google Ads when traffic_debloat on.
   - Ghost geo: with strict on, city Rome/Amsterdam/Roma stored as Unknown (or null) in session/geo.
   - 10s reuse: two page_views same fingerprint + same normalized URL within 10s → one session, two events.
   - Cron: when lock is held, cron returns 200 with `skipped: true`, `reason: 'lock_held'`; lock released in finally.

---

## 5. Special focus (P0 if missing)

| Focus | Status | Evidence / action |
|-------|--------|-------------------|
| Skip path: idempotency insert billable:false, no usage increment, processed_signals terminal | Gap | PR-T1: `ingest-skip-path-invariants.test.ts` |
| Valid click-id (len>=10) for Ads attribution | Partial | `bot-referrer-gates.test.ts` has hasValidClickId; PR-T1: assert usage in attribution/skip path |
| Ghost geo strict back-compat (flag off => no change) | Covered | `geo.test.ts` strictGhostGeo false/absent; PR-T1: reinforce + site-scoped flag off in process-sync-event test |
| page_view 10s session reuse (no double session) under flag | Gap | PR-T2: `page-view-10s-reuse.test.ts` (reuse path, no new session when match in 10s) |
| Cron lock: lock_held => 200 skipped + release in finally | Covered | `cron-vercel-get-handlers.test.ts` (source); PR-T3 optional runtime |

---

## 6. File reference (evidence)

- **Unit (selection):** `tests/unit/idempotency.test.ts`, `tests/unit/ingest-billable.test.ts`, `tests/unit/geo.test.ts`, `tests/unit/bot-referrer-gates.test.ts`, `tests/unit/normalize-landing-url.test.ts`, `tests/unit/attribution-service.test.ts`, `tests/unit/rate-limit-service.test.ts`, `tests/unit/sync-worker-redis-resilience.test.ts`, `tests/unit/cron-vercel-get-handlers.test.ts`, `tests/unit/compliance-freeze.test.ts`, `tests/unit/revenue-kernel-gates.test.ts`, `tests/unit/call-event-db-idempotency.test.ts`, `tests/unit/tenant-scope-audit.test.ts`, `tests/unit/sync-route-ratelimit.test.ts`, `tests/unit/sync-fallback-recover.test.ts`, `tests/unit/require-cron-auth.test.ts`, `tests/unit/enqueue-from-sales.test.ts`, `tests/unit/process-offline-conversions.test.ts`, `tests/unit/google-ads-adapter.test.ts`.
- **Integration/RLS/Billing:** `tests/rls/tenant-rls-proof.test.ts`, `tests/billing/reconciliation.test.ts`, `tests/billing/lifecycle.test.ts`, `tests/billing/financial-proofing.test.ts`.
- **Other:** `tests/intent-flow.test.ts`, `tests/api-verify-handshake.test.ts`, `tests/ledger-immutability.test.ts`, `tests/dashboard-watchtower.spec.ts`, `tests/unit/call-event-consent-hardening.test.ts`, `tests/unit/gdpr-consent-gates.test.ts`.

---

## 7. Execution summary

- **Run unit suite:** `npm run test:unit` (covers `tests/unit/*.test.ts`).
- **Run RLS:** `npm run test:rls`.
- **Run intent/ledger/verify:** `npm run test:intent-flow`, `test:ledger`, `test:verify-handshake` as needed.
- **After PR-T1:** New P0 tests must pass before enabling `ingest_strict_mode` on a production site.
- **No feature code changes** in this matrix; only new tests and minor edits to existing test files as specified.

---

## Enterprise Test Matrix v1.1 — DB-Level Invariant Tests

**Purpose:** DB-backed integration tests for production-critical ingest invariants. Same constraints as v1: no UI/i18n/production behavior changes; only tests; `ingest_idempotency` remains billing SoT; runner `node --import tsx --test`; no flakiness (no sleeps, deterministic time when needed).

**Prerequisites:** Supabase env (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) and a dedicated test site UUID in `STRICT_INGEST_TEST_SITE_ID`. Tests skip when env/site is missing.

### New test files and invariants

| ID | File | Invariant | How it prevents production regressions |
|----|------|-----------|----------------------------------------|
| **PR-T1.1** | `tests/integration/strict-ingest-skip-db.test.ts` | Skip path (traffic_debloat + bot UA, no valid click id): (1) `ingest_idempotency` row exists with `billable = false`; (2) usage count unchanged; (3) no session created; (4) `processed_signals` terminal status (skipped); (5) retry hits idempotency duplicate. | Ensures bot traffic never increments billing, never creates sessions, and retries are idempotent. Catches regressions in worker skip path or idempotency/usage logic. |
| **PR-T1.2** | `tests/integration/pageview-10s-reuse-db.test.ts` | With `page_view_10s_session_reuse: true`: same fingerprint + same normalized URL within 10s → one session, two events; `session.updated_at` increased after second event; different URL or fingerprint → new session. | Ensures 10s reuse does not create duplicate sessions and that URL/fingerprint divergence still creates new sessions. |
| **PR-T1.3** | `tests/integration/ads-attribution-strict-db.test.ts` | With `traffic_debloat: true`: (A) referrer google, no gclid → `attribution_source` not Google Ads; (B) gclid length &lt; 10 → not attributed to Google Ads; (C) gclid length ≥ 10 → attributed (First Click (Paid)). | Prevents false Google Ads attribution from organic referrer or junk gclid; ensures valid click-id is required for Ads attribution. |

### GO/NO-GO relevance (v1.1)

- **GO:** All three integration test files run and pass (or skip when env/site not configured). With test site and Supabase configured, PR-T1.1, PR-T1.2, and PR-T1.3 must pass before enabling strict ingest in production.
- **NO-GO:** Any of the above tests fail when run with a valid test site and Supabase (e.g. billing increment on skip, duplicate sessions on 10s reuse, or wrong attribution_source for A/B/C).

### Execution (v1.1)

- **Run DB-level integration tests:** `npm run test:integration` (or `node --import tsx --test tests/integration/strict-ingest-skip-db.test.ts tests/integration/pageview-10s-reuse-db.test.ts tests/integration/ads-attribution-strict-db.test.ts`).
- Set `STRICT_INGEST_TEST_SITE_ID` to a test site UUID and ensure site exists; tests restore site config and clean up inserted rows in `t.after`.

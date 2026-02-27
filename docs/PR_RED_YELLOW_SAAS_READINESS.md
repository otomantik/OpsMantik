# PR: RED & YELLOW SaaS Readiness Fixes (Backend/API Only)

## Summary

Implements **RED** and **YELLOW** items from the ReportBot Global SaaS Readiness Audit. Backend/API/data only; no new features; no BLUE items. Changes are minimal, backward-compatible, and safe. Revenue Kernel / OCI / ingest order semantics preserved.

---

## Changes by Item

| Item | Description |
|------|-------------|
| **RED-1** | Auto-junk cron: fixed broken filter (`.lt('expires_at', adminClient.rpc('now'))` → use `new Date().toISOString()`), replaced `console.log` with `logInfo`. |
| **RED-2 + YELLOW-5** | Test-notification cron: auth in all envs via `requireCronAuth(req)`; accepts `x-vercel-cron: 1` or `Authorization: Bearer <CRON_SECRET>`. |
| **RED-3** | Entitlements: in-repo documentation (Launch vs Tiered mode) + one-time runtime warning when production runs with STRICT unset. No logic change. |
| **YELLOW-1** | Call-event (v1 + v2): gate on `core_oci` in `active_modules`; 403 with `MODULE_NOT_ENABLED` when module missing. |
| **YELLOW-2** | Test routes: `test-oci` and `create-test-site` return 404 in production (dev/sandbox only). |
| **YELLOW-3** | Replaced `console.*` with logger in 7 specified files; ESLint no-console rule scoped to those files. |
| **YELLOW-4** | Narrowed `any` in runner, google-ads-export, calc-brain-score, process-offline-conversions, predictive-engine; added shared types where needed. |
| **YELLOW-6** | Auto-junk: Vercel Cron schedule in `vercel.json` (`0 2 * * *`); auth switched from QStash to `requireCronAuth`. |

---

## File List (Exact)

### Code

- `app/api/cron/auto-junk/route.ts` — query fix, logger, requireCronAuth
- `app/api/cron/test-notification/route.ts` — requireCronAuth in all envs
- `app/api/cron/watchtower/route.ts` — console → logError
- `app/api/call-event/route.ts` — core_oci gate, active_modules, getBuildInfoHeaders
- `app/api/call-event/v2/route.ts` — core_oci gate, active_modules, getBuildInfoHeaders
- `app/api/test-oci/route.ts` — production 404
- `app/api/create-test-site/route.ts` — production 404
- `app/api/workers/google-ads-oci/route.ts` — console → logger
- `app/api/workers/calc-brain-score/route.ts` — console → logger, ScoreBreakdown typing
- `app/api/oci/google-ads-export/route.ts` — SiteValuationRow typing
- `lib/entitlements/getEntitlements.ts` — doc comment + one-time warning
- `lib/auth/is-admin.ts` — console → logger
- `lib/oci/runner.ts` — console → logRunnerError, SiteValuationRow
- `lib/oci/oci-config.ts` — IntentWeightsRecord, SiteValuationRow
- `lib/services/watchtower.ts` — console → logger
- `lib/cron/process-offline-conversions.ts` — QueueRow.action_key typing
- `lib/valuation/predictive-engine.ts` — weights type
- `lib/logging/logger.ts` — (no change; imports only)
- `eslint.config.mjs` — no-console rule for the 7 specified files (+ override for logger.ts)

### Config

- `vercel.json` — cron entry for `/api/cron/auto-junk` (schedule: `0 2 * * *`)

### Tests

- `tests/unit/auto-junk-route.test.ts` — source-inspection (no .rpc('now'), .lt('expires_at'), logInfo, requireCronAuth)
- `tests/unit/call-event-consent-hardening.test.ts` — test A: allow v2 when no direct insert in route

### Lint / Unrelated fixes (to pass lint)

- `lib/contexts/site-modules-context.tsx` — useMemo deps: `activeModules.join(',')` → `activeModules`
- `components/dashboard/widgets/ad-spend-widget.tsx` — catch (e) → catch
- `tests/unit/predictive-engine.test.ts` — removed unused DEFAULT_INTENT_WEIGHTS import

---

## Risks

- **Auto-junk**: Now on Vercel Cron + CRON_SECRET; if CRON_SECRET is unset in an env, cron will 403 until fixed. QStash trigger for auto-junk should be removed or kept as backup per ops choice.
- **Call-event**: Sites without `core_oci` in `active_modules` will get 403 on POST call-event; ensure tenants that should have OCI have the module enabled.
- **Test routes**: test-oci and create-test-site are disabled in production; no impact on prod traffic.

---

## Smoke Steps

1. **Auto-junk**
   - No headers → `GET/POST /api/cron/auto-junk` → **403**.
   - Header `x-vercel-cron: 1` or `Authorization: Bearer <CRON_SECRET>` → **200** (and once run, expired pending rows move to junk).
2. **Test-notification**
   - No headers → **403** (in all envs, including staging/preview).
   - `x-vercel-cron: 1` or Bearer CRON_SECRET → **200**.
3. **Call-event**
   - Site with `active_modules` missing `core_oci` → POST call-event → **403** with body `{ error: 'Module not enabled', code: 'MODULE_NOT_ENABLED', required_module: 'core_oci' }`.
4. **Test routes**
   - With `NODE_ENV=production`: `GET /api/test-oci`, `POST /api/create-test-site` → **404**.

---

## Verification

- `npm run lint` — **passes** (including no-console rule for the 7 files).
- `npm run test:unit` — **319 pass**. There are **14 pre-existing failures** in other tests (call-event-db-idempotency, compliance-freeze, revenue-kernel-gates, etc.) that assert on implementation details (e.g. `tryInsert(siteIdUuid`, `23505` in v2 route, `qstash.publishJSON` in sync route) that no longer exist in the current codebase; these are **out of scope** for this PR.

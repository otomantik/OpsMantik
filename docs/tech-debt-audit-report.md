# OpsMantik: Ruthless Tech Debt & Performance Audit Report

**Audit Date:** 2026-02-25  
**Scope:** Next.js App Router, API routes, Supabase access patterns, React hooks, state management

---

## Summary

The codebase is **stable and functional** but carries significant technical debt that will slow future development and hurt performance at scale. The biggest risks: **massive hooks**, **synchronous webhook handling**, and **over-use of Client Components**. An Enterprise Architect would prioritize: (1) splitting the 500+ line hooks, (2) offloading ingest to background workers, (3) introducing caching for static/semi-static data.

---

## 🔴 CRITICAL (Fix Immediately)

### 1. Webhook / Ingest Handlers Block Response Until DB Work Completes

**Files:** `app/api/sync/route.ts` (559 lines), `app/api/call-event/route.ts` (528), `app/api/call-event/v2/route.ts` (460), `app/api/webhooks/google-spend/route.ts`

**Problem:** All handlers do full DB work (idempotency, insert, quota, etc.) before returning 200. On burst traffic or slow DB, clients (e.g. Google Ads Script, tracker) can hit timeouts. Vercel/serverless has strict execution limits; long sync runs risk 504s.

**Enterprise Fix:**
- **Sync & call-event:** Return `202 Accepted` immediately after validating payload + idempotency check; publish to QStash/queue for async processing. Already using QStash for worker—extend to always respond 202 and process async.
- **Webhooks:** Same pattern—validate, enqueue, return 200. Processing in background worker.

---

### 2. 500+ Line Hooks Violate Single Responsibility Principle

**Files:**
- `lib/hooks/use-realtime-dashboard.ts` — **625 lines**
- `lib/hooks/use-queue-controller.ts` — **565 lines**

**Problem:** Both hooks mix: fetching, realtime subscriptions, state, side effects, business logic. A single change risks regressions across the whole flow. Testing is hard; onboarding is slow.

**Enterprise Fix:**
- **use-realtime-dashboard:** Extract into: `useRealtimeChannel` (subscription lifecycle), `useRealtimeEventHandler` (payload → state), `useRealtimeConnectionStatus`. Keep hook as a thin orchestrator.
- **use-queue-controller:** Extract: `useQueueIntents` (fetch + SWR), `useQueueSealFlow` (seal modal + API), `useQueueDrawer` (drawer + details fetch), `useQueueHistory` (activity log). Compose in a facade hook.

---

### 3. Site Access Check: 3–4 Sequential DB Round-Trips Per Page Load

**File:** `app/dashboard/site/[siteId]/page.tsx` (lines 94–136)

**Problem:**
```ts
// Query 1: ownedSite
// Query 2: membership (if !ownedSite)
// Query 3: site_members.role (for siteRole)
```
Three separate Supabase calls, no caching. Every site dashboard load does this on the critical path.

**Enterprise Fix:**
- Create RPC `get_site_access_for_user(p_user_id, p_site_id)` returning `{ has_access, role }` in one round-trip.
- Or use `can_access_site()` + a role RPC; consolidate to 1–2 calls.
- Optionally cache result for the request (React `cache()` or request-scoped memo).

---

## 🟡 WARNING (Refactor Soon)

### 4. Over-Use of `'use client'` Where Server Components Would Suffice

**Count:** 50+ components/hooks with `'use client'`.

**Examples that could be Server Components:**
- `components/dashboard/intent-status-badge.tsx` — presentational
- `components/dashboard/intent-type-badge.tsx` — presentational  
- `components/dashboard/confidence-score.tsx` — presentational
- `components/dashboard/month-boundary-banner.tsx` — can receive props from server

**Impact:** Every Client Component adds to the client bundle and blocks streaming. Small badges and static UI don’t need interactivity.

**Fix:** Convert presentational components to Server Components. Pass data as props from parent Server Components. Only add `'use client'` where hooks (useState, useEffect, useContext) are required.

---

### 5. Login Page is Client Component Unnecessarily

**File:** `app/login/page.tsx`

**Problem:** Uses `'use client'` for `useEffect` + `useRouter` to redirect if already logged in. Entire login UI is client-rendered.

**Fix:** Use middleware to redirect authenticated users before the page renders. Keep login form as a Client Component if needed for OAuth, but make the page shell a Server Component that checks auth server-side and redirects.

---

### 6. N+1-Like Pattern: SessionGroup Fetches Call Per Mount

**File:** `components/dashboard/session-group.tsx` (lines 117–136)

**Problem:** Each `SessionGroup` mounts and runs `useEffect` → `supabase.from('calls').select(...).eq('matched_session_id', sessionId)`. N groups = N queries.

**Fix:** Parent (e.g. QualificationQueue or DashboardShell) fetches all calls for visible sessions in one query, passes down via props or context. Or add RPC `get_calls_for_sessions(p_session_ids[])` and batch-fetch.

---

### 7. No Caching for Static / Semi-Static Data

**Missing:**
- Site config (currency, timezone, active_modules) — fetched per request
- Entitlements / capabilities — re-fetched often
- `bountyChips`, `siteCurrency` from `useSiteConfig` — no SWR/cache TTL

**Fix:**
- Use `unstable_cache` or React `cache()` for site config with 60s–5min TTL.
- Add SWR/React Query with `staleTime` for entitlements.
- Site list on dashboard page — could be cached briefly per user.

---

### 8. Duplicated Site Access Logic

**Files:** `app/dashboard/site/[siteId]/page.tsx`, RLS policies, `can_access_site()`

**Problem:** Page implements custom access check (owner vs membership vs role) instead of reusing `can_access_site` and a single role RPC. Logic is duplicated and can drift.

**Fix:** Centralize in `get_site_access_for_user` RPC. Page calls RPC once; remove inline owner/membership queries.

---

### 9. Massive API Route Files

**Files:**
- `app/api/sync/route.ts` — 559 lines
- `app/api/call-event/route.ts` — 528 lines
- `app/api/call-event/v2/route.ts` — 460 lines

**Problem:** Auth, validation, idempotency, quota, publish, error handling all in one file. Hard to test and reason about.

**Fix:** Extract: `validateSyncPayload`, `checkSyncQuota`, `publishSyncToQStash`, `createSyncResponse` into `lib/sync/` modules. Route becomes a thin orchestrator. Same pattern for call-event.

---

### 10. lib/oci/runner.ts — 851 Lines

**Problem:** Single file owns claiming, upload, error handling, circuit breaker, metrics, semaphores. Any change touches a huge surface.

**Fix:** Split into: `claimJobs`, `runUploadBatch`, `handleUploadResult`, `circuitBreaker`, `persistOutcome`. Compose in `runOfflineConversionRunner`. Test each unit in isolation.

---

## 🔵 OPTIMIZATION (Nice to Have)

### 11. Expand `next/dynamic` for Heavy Widgets

**Current:** `BreakdownWidgets`, `PulseProjectionWidgets`, `CROInsights` (and similar) are dynamically imported in `dashboard-shell.tsx`.

**More candidates:**
- `TimelineChart` (316 lines)
- `SessionDrawer` / `LazySessionDrawer`
- `QualificationQueue` (if above-the-fold isn’t critical)
- Chart libraries (recharts, etc.)

**Benefit:** Smaller initial bundle, faster TTI.

---

### 12. Hardcoded E2E Filter in Production Path

**File:** `app/dashboard/page.tsx` (line 42)

```ts
const sites = rawSites?.filter((s) => s.name !== E2E_SITE_NAME_FILTER) ?? [];
```

**Problem:** Production code filters by `'E2E Conversation Layer'`. If a real site has that name, it disappears. Logic belongs in test setup, not production.

**Fix:** Use env flag `NODE_ENV === 'test'` or `E2E_MODE` to apply filter. Or exclude E2E sites via RLS/test-only logic.

---

### 13. TypeScript `any` Usage

**File:** `app/api/create-test-site/route.ts` — uses `as any`.

**Fix:** Add proper types or `unknown` with type guards. Avoid `any` in API routes.

---

### 14. Context Provider Nesting

**Current:** `I18nProvider` + `SiteModulesProvider` + `I18nProvider` wraps dashboard.

**Impact:** Each context change can re-render large trees. Keep contexts narrow and memoize values.

**Fix:** Split i18n into `LocaleContext` (locale only) and `MessagesContext` (messages) if messages are heavy. Use `useMemo` for context values.

---

### 15. site/[siteId]/page.tsx: Repeated `site_members` Queries

**Problem:** Two separate `site_members` queries—one for access, one for role. Same table, same filters.

**Fix:** Single query: `select('role').eq('site_id', X).eq('user_id', Y)` and derive both access and role from one result.

---

## Appendix: File Size Reference

| File | Lines |
|------|-------|
| lib/oci/runner.ts | 851 |
| lib/hooks/use-realtime-dashboard.ts | 625 |
| components/dashboard/sites-manager.tsx | 567 |
| lib/hooks/use-queue-controller.ts | 565 |
| lib/i18n/messages/en.ts | 575 |
| app/api/sync/route.ts | 559 |
| app/api/call-event/route.ts | 528 |
| app/api/call-event/v2/route.ts | 460 |
| components/dashboard/cards/intent-card.tsx | 408 |
| lib/providers/google_ads/adapter.ts | 385 |
| components/dashboard/dashboard-shell.tsx | 320 |
| components/dashboard/session-group/session-card-expanded.tsx | 317 |
| components/dashboard/timeline-chart.tsx | 316 |
| components/dashboard/session-group.tsx | 304 |

---

## Priority Action List

1. **This sprint:** Offload sync/call-event to async (202 + queue); add `get_site_access_for_user` RPC.
2. **Next sprint:** Split `use-realtime-dashboard` and `use-queue-controller` into smaller hooks.
3. **Backlog:** Convert presentational components to Server Components; expand `next/dynamic`; add caching for site config and entitlements.

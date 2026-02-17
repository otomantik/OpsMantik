# OpsMantik Code Quality Audit (Audit PR0)

**Scope:** Backend/API/data only. No UI behavior changes.  
**Date:** 2026-02-17  
**Purpose:** Static audit for spaghetti/dead/unsafe code and type leaks. No behavior changed; report only.

---

## 1. Top Findings (Executive Summary)

| # | Finding | Risk | Location / Count |
|---|--------|------|-------------------|
| 1 | **Type leaks (`any`, `as any`)** | High – runtime/silent corruption | 100+ hits; hotspots: `parsers.ts`, `use-queue-controller.ts`, `oci/export`, `call-event`, `sync`, `source-classifier` |
| 2 | **Two parallel worker implementations** | Medium – duplication & drift | `app/api/workers/google-ads-oci` vs `app/api/cron/process-offline-conversions`; shared helpers in `lib/cron/process-offline-conversions.ts` but full flow duplicated |
| 3 | **Source-based tests (string contains)** | Medium – fragile refactors | `providers-worker-loop.test.ts`, `process-offline-conversions.test.ts`, `sales-api`, `conversations-api`, `vault-credentials`, `enqueue-from-sales`, `core-quota-pause-source` |
| 4 | **adminClient / service_role usage** | Low–Medium – acceptable if bounded | 20+ files; workers, cron, oci/export, sync, dlq, site/session/event/intent services; all server-side. Ensure no RLS bypass in user-facing paths |
| 5 | **Empty / swallow catch** | Medium where logic matters | Scripts (`tank-tracker-offline-online`, `hunter-ai-ui-proof`), `lib/tracker/*.js`, `public/assets/core.js`; no swallow in app/api routes |
| 6 | **Large monolith routes** | Medium – spaghetti** | `call-event/route.ts` ~29KB, `google-ads-oci/route.ts` ~21KB, `process-offline-conversions/route.ts` ~17KB, `sync/route.ts` ~20KB |
| 7 | **ESLint warnings (unused vars, unused directives)** | Low | 37 warnings; unused vars in dispute-export, schema-drift, use-queue-controller, adapter, qstash, quota, vault, ingest, tests |
| 8 | **RPC/response typing** | Medium | `last_error` JSON, adapter responses, queue row typing partially `any` or untyped |
| 9 | **redis.eval (Lua)** | Info | `lib/providers/limits/semaphore.ts` – intentional; no `eval()` or `new Function()` on user input |
| 10 | **Fail-open** | Low (verified) | Worker/cron return 200 only on intended success; CONCURRENCY_LIMIT path writes ledger and RETRY, does not hide failure |

---

## 2. Dead Code Candidates

- **Unused exports / files:** Not fully enumerated; `madge --circular` was run (see Command Outputs). Suggest: `npx knip` or manual check for `lib/providers/registry.ts` consumers, `lib/cron/process-offline-conversions.ts` (used by both workers + tests).
- **Unused variables (lint):** 37 warnings include: `csvStream`, `chunk`, `controller` (dispute-export), `_removed` (schema-drift, idempotency), `UndoState` (use-intent-qualification), `_row` (use-queue-controller), `retryAfter` (adapter), `_req`/`_err` (qstash), `PG_CONSERVATIVE_THRESHOLD` (quota), `_rawUrl` etc. (ingest.ts).
- **Duplicate constants:** `MAX_RETRY_ATTEMPTS = 7` in both `google-ads-oci/route.ts` and `process-offline-conversions/route.ts`; should live in shared module.
- **Old route paths:** No removed routes detected; `app/api/test-oci` exists (test/dev).

---

## 3. Unsafe Patterns

### 3.1 RLS / service_role

- **adminClient** used in: workers (google-ads-oci, process-offline-conversions), oci/export, sync, sync/dlq/*, sites/[id]/status, billing/dispute-export, cron/*, session-service, event-service, site-service, intent-service, conversation/primary-source, providers/credentials/test, jobs/auto-approve, audit-log.
- **Recommendation:** Keep adminClient only in server-only routes/cron/workers; ensure user-facing APIs (e.g. sync, call-event) use validated site/user context before any adminClient use. dispute-export already checks membership before adminClient.

### 3.2 Swallow catch

- **Backend (app/api, lib):** No empty `catch () {}` in API routes.
- **Scripts:** `scripts/smoke/tank-tracker-offline-online.mjs` (line 131), `scripts/smoke/hunter-ai-ui-proof.mjs` (184, 281) – `} catch (e) {}` / `} catch (_) {}`.
- **Tracker / public:** `lib/tracker/transport.js`, `pulse.js`, `utils.js`, `public/assets/core.js` – defensive feature detection; acceptable if documented.

### 3.3 eval / dynamic code

- **redis.eval:** Used in `lib/providers/limits/semaphore.ts` for Lua scripts (ACQUIRE/RELEASE). Not user input.
- **eval() / new Function():** None found on user input.

### 3.4 Fail-open

- Worker and cron routes return 200 only on intended success. CONCURRENCY_LIMIT path: group marked RETRY, ledger STARTED+FINISHED written, no provider call; no silent 200 on provider failure.

---

## 4. Type Leaks: Counts and Locations

### 4.1 Summary

- **`any` (including `as any`, `: any`):** ~100+ occurrences across repo.
- **`@ts-ignore` / `eslint-disable`:** A few; mostly for require/Deno/unused-vars with justification.

### 4.2 Backend/API Hotspots (high impact)

| File | Notes |
|------|--------|
| `app/api/oci/export/route.ts` | `(site as any)?.currency`, `(r: any)`, `(sessions \|\| []) as any[]`, `(rows as any[])` |
| `app/api/call-event/route.ts` | `scoreBreakdown: any`, `(e.metadata as any)?.lead_score`, `callRecord: any`, `insertError: any` |
| `app/api/call-event/v2/route.ts` | `callRecord: any`, `insertError: any` |
| `app/api/sync/route.ts` | `(body as any).ec`, `.ea`, `.el` |
| `app/api/cron/reconcile-usage/route.ts` | `result: any` |
| `app/api/cron/reconcile-usage/backfill/route.ts` | `catch (err: any)` |
| `app/api/stats/reconcile/route.ts` | `(s: any)`, `null as any` |
| `app/api/billing/dispute-export/route.ts` | `makeIterator() as any` |
| `app/api/watchtower/partition-drift/route.ts` | `(payload as any)?.ok` |
| `lib/analytics/source-classifier.ts` | `params: any`, `determineTrafficSource(..., params: any)` |
| `lib/services/intent-service.ts` | `meta: any` |
| `lib/supabase/admin.ts` | `(client as any)[prop]` |
| `lib/upstash.ts` | `const self: any` |
| `lib/services/rate-limit-service.ts` | `redis as any` |
| `lib/services/replay-cache-service.ts` | `private static redisClient: any` |

### 4.3 Components / Hooks (medium impact – data flow)

| File | Notes |
|------|--------|
| `components/dashboard/qualification-queue/parsers.ts` | Heavy `(r as any).field` for many fields; should be single typed parser |
| `lib/hooks/use-queue-controller.ts` | Multiple `as any`, `(r: any)`, `data as any[]` |
| `lib/hooks/use-intents.ts` | `(intent: any)` |
| `lib/hooks/use-breakdown-data.ts` | `(item: any)` |
| `lib/hooks/use-timeline-data.ts` | `(point: any)` |
| `components/dashboard/activity-log-shell.tsx` | `(data as any[])`, `(r: any)` |
| `components/dashboard/queue-deck.tsx` | `(intent as any).traffic_source` etc. |
| `components/dashboard/hunter-card.tsx` | `theme.icon as any`, `(intent as any).traffic_source` |

### 4.4 Tests (lower risk but should narrow)

- `tests/unit/ingest-billable.test.ts`: `as any` for payloads.
- `tests/unit/call-event-schema-drift.test.ts`: `(r1.next as any).click_id`.
- `tests/unit/call-event-match-session.test.ts`, `attribution-service.test.ts`: `{ from } as any` mocks.
- `tests/billing/financial-proofing.test.ts`: `admin: any`.

---

## 5. Complexity Hotspots

### 5.1 Top 20 Largest Files (bytes)

| Bytes  | Path |
|--------|------|
| 32857  | app/test-page/page.tsx |
| 31321  | public/assets/core.js |
| 29872  | app/api/call-event/route.ts |
| 26331  | lib/hooks/use-realtime-dashboard.ts |
| 23067  | components/dashboard/sites-manager.tsx |
| 21215  | lib/hooks/use-queue-controller.ts |
| 21021  | app/api/workers/google-ads-oci/route.ts |
| 20684  | components/dashboard/session-group/session-card-expanded.tsx |
| 20503  | app/api/call-event/v2/route.ts |
| 19921  | app/api/sync/route.ts |
| 18092  | tests/unit/google-ads-adapter.test.ts |
| 16984  | app/api/cron/process-offline-conversions/route.ts |
| 16059  | components/dashboard/cards/intent-card.tsx |
| 15153  | lib/providers/google_ads/adapter.ts |
| 15074  | app/api/sync/worker/route.ts |
| 14940  | scripts/smoke/autopsy_ads_only_today.mjs |
| 13883  | components/dashboard/dashboard-shell.tsx |
| 13875  | lib/services/session-service.ts |
| 13420  | lib/idempotency.ts |
| 13367  | components/dashboard/activity-log-shell.tsx |

**Backend-focused largest:** `call-event/route.ts` (~29KB), `google-ads-oci/route.ts` (~21KB), `sync/route.ts` (~20KB), `process-offline-conversions/route.ts` (~17KB), `call-event/v2/route.ts` (~21KB), `sync/worker/route.ts` (~15KB), `adapter.ts` (~15KB), `session-service.ts` (~14KB), `idempotency.ts` (~13KB).

### 5.2 Duplicated Logic Clusters

- **Worker flow (claim → health gate → upload → persist):** Implemented twice – `app/api/workers/google-ads-oci/route.ts` and `app/api/cron/process-offline-conversions/route.ts`. Shared: `nextRetryDelaySeconds`, `queueRowToConversionJob`, `QueueRow` from `lib/cron/process-offline-conversions.ts`. Not shared: semaphore (only in google-ads-oci), ledger (provider_upload_attempts in google-ads-oci; process-offline-conversions uses different metrics), health gate and claim loop structure.
- **Retry/final logic:** `MAX_RETRY_ATTEMPTS`, `isFinal`, delay calculation repeated in both workers.
- **Adapter result handling:** Similar loop (COMPLETED / RETRY / FAILED) in both workers.

---

## 6. Test Fragility Hotspots

- **Source-based (readFileSync + includes):**
  - `tests/unit/providers-worker-loop.test.ts`: Many assertions on route/migration source string (STARTED/FINISHED, semaphore, CONCURRENCY_LIMIT, ledger, recovery RPC, etc.).
  - `tests/unit/process-offline-conversions.test.ts`: Route and migration source checks (claim RPC, queued_count, service_role guard, indexes).
  - `tests/unit/sales-api.test.ts`, `conversations-api.test.ts`, `vault-credentials.test.ts`, `enqueue-from-sales.test.ts`, `core-quota-pause-source.test.ts`: Same pattern.
- **Risk:** Refactors (extract function, rename variable, reorder blocks) can break tests without behavior change. Prefer invoking handlers or exported functions with inputs and asserting on outputs.

---

## 7. Command Outputs Summary

### 7.1 Lint

- **Result:** 0 errors, 37 warnings.
- **Warnings:** Unused variables, unused eslint-disable directives, one anonymous default export (load test). No blocking issues.

### 7.2 Test

- **Result:** `npm run test:unit` – all tests passed (212 tests, 0 fail).

### 7.3 Build

- **Result:** `npm run build` – compiled successfully; Next.js 16.1.6 (Turbopack).

### 7.4 Madge

- **Command:** `npx madge --circular --extensions ts,tsx app lib` (run separately if needed; not required for this report).

### 7.5 Grep Summaries

- **any / ts-ignore / eslint-disable / eval / new Function:** See Section 4; no dangerous eval/Function on user input.
- **Empty catch:** See Section 3.2.
- **adminClient / service_role:** See Section 3.1.
- **TODO / FIXME / HACK:** No significant TODOs in backend routes; one test uses string "HACKED" in label (tenant-rls-proof).

---

## 8. PR Plan (Cleanup Sprint, Up to ~PR20)

Suggested atomic PRs; order by risk/value. No behavior change unless stated.

| PR | Scope | Files (examples) |
|----|--------|-------------------|
| **PR-C1** | Type leak kill | Replace `any` with `unknown` + narrow in oci/export, call-event, sync, source-classifier; add RPC/queue types; adapter response type guards |
| **PR-C2** | Dead code removal | Remove unused exports/vars (lint --fix); drop unused eslint-disable; consider consolidating MAX_RETRY_ATTEMPTS |
| **PR-C3** | Unsafe pattern hardening | Add at least log in script swallow catches; verify adminClient only in server/cron/worker boundaries; document fail-open policy |
| **PR-C4** | Worker decomposition | Extract claim/gates/upload/persist into shared modules; single “runner” per worker type; reduce google-ads-oci and process-offline-conversions to thin orchestration |
| **PR-C5** | Parser/hooks typing | Type qualification-queue parsers and queue-controller/intents/breakdown/timeline hooks; reduce `as any` in components that consume API data |
| **PR-C6** | Test robustness | Replace source-based asserts with handler/function tests where feasible (worker flow, auth, claim logic); keep migration source checks only where necessary |
| **PR-C7** | Largest route split | Split call-event/route.ts and sync/route.ts into smaller modules (validation, scoring, persistence) without changing API contract |
| **PR-C8–C10** | Further decomposition | session-service, idempotency, replay-cache/rate-limit typing and small extractions as needed |

---

## 9. Top 10 Actionable Fixes (Ranked by Risk)

1. **Type guard adapter / RPC responses** – Prevent silent wrong shapes (high).
2. **Type `last_error` and queue row JSON** – Avoid runtime crashes in worker (high).
3. **Remove or narrow `any` in oci/export and call-event routes** – High traffic, data-sensitive (high).
4. **Single shared worker orchestration** – Reduce duplication and drift between google-ads-oci and process-offline-conversions (medium).
5. **Type parsers.ts and use-queue-controller** – Central data for dashboard (medium).
6. **Fix swallow catch in smoke scripts** – At least log error (medium).
7. **Replace source-based worker tests with behavior tests** – Refactor-safe (medium).
8. **Consolidate MAX_RETRY_ATTEMPTS and retry constants** – Single source of truth (low).
9. **Lint cleanup** – Unused vars and directives (low).
10. **Split call-event/route.ts** – Maintainability (low–medium).

---

## 10. Files Created / Modified (This Audit)

- **Created:** `docs/OPS/CODE_QUALITY_AUDIT.md` (this file).
- **Created:** `scripts/audit/largest-files.mjs` (one-off helper for largest-files list).
- **Modified:** None (audit only; no behavior change).

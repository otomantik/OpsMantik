# OpsMantik — Cleanup Backlog (with proofs)

**Generated:** 2026-02-02  
**Scope:** Partition/trigger alignment, RPC contract drift, timezone/range standards, orphans, realtime source-of-truth, UI hook risks.

---

## 1) Summary

- **Partition / trigger–worker:** Triggers exist and were fixed (20260201210000, 20260202030000); drift can recur if inserts bypass triggers or session `created_month` is updated. Audit query `bad_events_partition_key` must stay 0; run `docs/AUDIT/CLEANUP_QUICK_AUDIT.sql` regularly.
- **RPC contract:** v1 (get_recent_intents_v1, get_command_center_p0_stats_v1) and v2 (date range vs since+minutes) coexist; UI prefers v2 with v1 fallback. get_recent_intents_v2 payload grew across many migrations; one grant script (20260131120000) still references dropped `get_dashboard_stats(uuid, int)`.
- **Realtime / timezone / UI:** Realtime = Redis overlay (GET /api/stats/realtime) + Supabase Realtime subscriptions + 10s poll in Command Center and 5min/500ms fallback polls in use-realtime-dashboard. TRT half-open ranges are standardized in `lib/time/today-range.ts` and RPCs; breakdown was aligned in 20260201180000. Hydration risks were mitigated with `suppressHydrationWarning` on relative-time elements; hook dependency arrays should be audited for stale closures/loops.

---

## 2) Findings

### P0 — Data correctness, attribution, prod incident, security

| ID | Finding | Evidence |
|----|---------|----------|
| P0-1 | **Partition drift recurrence** — Events can again have `session_month <> session.created_month` if trigger is dropped or inserts bypass it (e.g. bulk load). | **Proof:** Migration `supabase/migrations/20260202030000_fix_events_partition_drift_only.sql` drops trigger before INSERT/DELETE and recreates it; if a future migration or manual change drops the trigger and doesn’t recreate it, new events can drift. `docs/AUDIT/CLEANUP_QUICK_AUDIT.sql` lines 17–20: `bad_events_partition_key` query. |
| P0-2 | **Orphan calls** — Rows in `calls` with `matched_session_id` non-null but no matching session (same site) break joins and attribution. | **Proof:** `docs/AUDIT/CLEANUP_QUICK_AUDIT.sql` lines 27–34: `calls_with_missing_session`; schema has no FK from `calls.matched_session_id` to `sessions` (partitioned). `supabase/migrations/20260128039000_critical_db_fixes.sql` line 9: "calls.matched_session_id has no FK". |
| P0-3 | **Orphan events** — Events with `session_id` pointing to missing session break RPCs that join events ↔ sessions. | **Proof:** `docs/AUDIT/CLEANUP_QUICK_AUDIT.sql` lines 36–38: `events_with_missing_session`. FK exists: `events(session_id, session_month)` → `sessions(id, created_month)`; orphans imply bad data or partition drift. |

### P1 — Performance, operator UX, growing tech debt

| ID | Finding | Evidence |
|----|---------|----------|
| P1-1 | **get_recent_intents_v2 payload growth** — Many migrations added columns to the RPC output; large payloads and 100-arg limit were fixed with to_jsonb (20260202020000, 20260202021000), but further field adds still risk contract drift. | **Proof:** `supabase/migrations/20260202020000_fix_get_recent_intents_v2_arg_limit.sql` line 2: "cannot pass more than 100 arguments". Many migrations from 20260129130000 through 20260201004000 each `CREATE OR REPLACE FUNCTION public.get_recent_intents_v2(...)`. |
| P1-2 | **Realtime source-of-truth ambiguity** — Command Center shows DB-backed P0 stats (get_command_center_p0_stats_v2) then overlays Redis counts (captured, junk, gclid) via 10s poll. Redis is “today” only; DB is source for sealed/queue. Operators can see mixed semantics. | **Proof:** `lib/hooks/use-command-center-p0-stats.ts` lines 92–118: setInterval 10s fetches `/api/stats/realtime` and merges into `stats` with `Math.max(prev, cap)` etc. `lib/services/stats-service.ts` lines 44–54: Redis key `stats:{siteId}:{date}` (TRT today from getTodayKey()). |
| P1-3 | **Multiple polling layers** — use-realtime-dashboard: 500ms connection poll, 5min activity fallback RPC (get_recent_intents_v1); use-command-center-p0-stats: 10s realtime API poll. Risk of redundant load and UI flicker. | **Proof:** `lib/hooks/use-realtime-dashboard.ts` lines 526–540 (500ms), 550–561 (activity poll get_recent_intents_v1); `lib/hooks/use-command-center-p0-stats.ts` lines 89–121 (10s). |
| P1-4 | **v1 vs v2 RPC coexistence** — UI uses v2 with v1 fallback when v2 not found. Two contracts (v1: p_since, p_minutes_lookback; v2: p_date_from, p_date_to) and two payload shapes increase maintenance and regression surface. | **Proof:** `components/dashboard/QualificationQueue.tsx` lines 226–261: preferV2 → get_recent_intents_v2, else get_recent_intents_v1. `supabase/migrations/20260128000000_hotfix_missing_rpcs.sql` lines 338–346: get_recent_intents_v1(p_site_id, p_since, p_minutes_lookback, p_limit, p_ads_only). |

### P2 — Cleanup, readability, maintainability

| ID | Finding | Evidence |
|----|---------|----------|
| P2-1 | **Dead grant code** — secure_rpc_stats migration revokes/grants `get_dashboard_stats(uuid, int)` which was dropped in an earlier migration. | **Proof:** `supabase/migrations/20260131120000_secure_rpc_stats.sql` lines 14–16: `EXECUTE 'REVOKE EXECUTE ON FUNCTION public.get_dashboard_stats(uuid, int)...'`. `supabase/migrations/20260128022000_drop_legacy_stats_rpc.sql` line 6: `DROP FUNCTION IF EXISTS public.get_dashboard_stats(uuid, int)`. |
| P2-2 | **Half-open vs BETWEEN** — Breakdown RPC was aligned to half-open in 20260201180000; any other RPC or app code still using BETWEEN for date ranges could be off-by-one. | **Proof:** `supabase/migrations/20260201180000_breakdown_half_open_range.sql` line 1–2: "half-open range [from, to) like get_command_center_p0_stats_v2". `supabase/migrations/20260130240000_dashboard_breakdown_v1.sql` previously used `BETWEEN p_date_from AND p_date_to` (inclusive). |
| P2-3 | **TRT vs UTC in scripts** — Perf and smoke scripts use UTC or “last 2h/24h”; dashboard UI uses TRT today from `lib/time/today-range.ts`. Cross-checking scripts vs UI ranges may require explicit TRT in scripts. | **Proof:** `lib/time/today-range.ts`: getTodayTrtUtcRange(), half-open [from, to). `scripts/perf/measure-baseline.mjs` lines 88–88: twoHoursAgo/twentyFourHoursAgo from `now()` UTC, no TRT. |
| P2-4 | **Hook dependency arrays** — use-command-center-p0-stats effect depends on `[siteId, rangeOverride?.day, !!stats]`; use-realtime-dashboard has multiple refs and intervals. Stale closures or missing deps could cause wrong refetches or loops. | **Proof:** `lib/hooks/use-command-center-p0-stats.ts` line 121: `}, [siteId, rangeOverride?.day, !!stats]);`. `lib/hooks/use-realtime-dashboard.ts`: dependency arrays on useEffect/useCallback should be audited for completeness. |
| P2-5 | **suppressHydrationWarning usage** — Used on relative-time and tabular-nums elements to avoid server/client time mismatch; any new client-only time formatting should follow same pattern to avoid hydration errors. | **Proof:** `components/dashboard/HunterCard.tsx` line 310: `suppressHydrationWarning`; `IntentCard.tsx` 240, 243; `QualificationQueue.tsx` 615, 645; `realtime-pulse.tsx` 33; `lazy-session-drawer.tsx` 130, 169. |

---

## 3) Evidence (index)

| Item | File / location |
|------|------------------|
| Partition drift fix | `supabase/migrations/20260202030000_fix_events_partition_drift_only.sql` |
| Partition triggers | `supabase/migrations/20260201210000_comprehensive_partition_cleanup_and_fix.sql` (sessions + events triggers) |
| Audit SQL | `docs/AUDIT/CLEANUP_QUICK_AUDIT.sql` (A–F sections) |
| Orphan queries | Same file, B) calls_with_missing_session, events_with_missing_session |
| get_recent_intents_v2 arg limit fix | `supabase/migrations/20260202020000_fix_get_recent_intents_v2_arg_limit.sql`, 20260202021000_enrich_... |
| get_recent_intents_v1 signature | `supabase/migrations/20260128000000_hotfix_missing_rpcs.sql` lines 338–346 |
| get_command_center_p0_stats_v2 | `supabase/migrations/20260201010000_executive_analytics_v2.sql`, 20260131000000_executive_analytics_stats.sql |
| Realtime Redis + poll | `lib/services/stats-service.ts`, `lib/hooks/use-command-center-p0-stats.ts` (10s), `lib/hooks/use-realtime-dashboard.ts` (500ms, 5min) |
| TRT half-open | `lib/time/today-range.ts` (getTodayTrtUtcRange, trtDateKeyToUtcRange) |
| Breakdown half-open | `supabase/migrations/20260201180000_breakdown_half_open_range.sql` |
| Dead get_dashboard_stats(uuid,int) | `supabase/migrations/20260131120000_secure_rpc_stats.sql` vs 20260128022000_drop_legacy_stats_rpc.sql |
| Hydration | `components/dashboard/HunterCard.tsx`, IntentCard, QualificationQueue, realtime-pulse, lazy-session-drawer (suppressHydrationWarning) |

---

## 4) Plan (ordered, smallest viable first)

1. **Run audit and fix drift (done)** — CLEANUP_QUICK_AUDIT.sql A/B; migration 20260202030000 for events drift. **Verification:** bad_sessions_partition_key = 0, bad_events_partition_key = 0.
2. **Document and run orphan checks** — Run B) calls_with_missing_session, events_with_missing_session; if > 0, fix matching logic or backfill; document in CLEANUP_QUICK_AUDIT.md. **Rollback:** No DB write until root cause is known.
3. **Remove dead grant code (P2-1)** — In a new migration, remove or adjust 20260131120000 logic so it only touches existing function signatures (e.g. get_dashboard_stats(uuid, timestamptz, timestamptz, boolean)). **Rollback:** Migration can be reverted; no semantic change if current DB has no (uuid,int) overload.
4. **Realtime semantics doc** — Add short doc (e.g. docs/REALTIME_SOURCE_OF_TRUTH.md): Redis = today overlay (captured/junk/gclid); DB = sealed/queue and historical; polling intervals and when each is used. **Rollback:** Doc only.
5. **RPC contract snapshot** — Export current get_recent_intents_v2 and get_command_center_p0_stats_v2 response shape (or link to types in lib/types/hunter.ts, use-command-center-p0-stats.ts) so future changes are checked against it. **Rollback:** Doc only.
6. **Optional: consolidate v1/v2** — Long-term: prefer single RPC (v2) and remove v1 fallback in UI once all environments have v2; deprecate v1. **Rollback:** Keep v1 until v2 is verified everywhere.
7. **Optional: reduce polling** — Consider single “realtime” channel or longer intervals if multiple polls cause load/flicker. **Rollback:** Revert interval/channel changes.

---

## 5) Verification

| Criterion | How to check |
|-----------|----------------|
| Partition drift = 0 | Run `docs/AUDIT/CLEANUP_QUICK_AUDIT.sql` A); both counts 0. |
| Orphans = 0 | Run B); calls_with_missing_session = 0, events_with_missing_session = 0. |
| RPCs respond | Run F) with real site UUID; get_recent_intents_v2 and get_command_center_p0_stats_v2 return without error. |
| No dead grant errors | After P2-1 fix, run migrations on a fresh DB or re-run 20260131120000; no exception. |
| Realtime API | GET /api/stats/realtime?siteId=<id> returns 200 and { captured, gclid, junk }. |
| Hydration clean | Build + start app; open dashboard; no React hydration warning in console. |

---

## 6) Prioritized Cleanup Backlog (10–30 items)

Ordered by risk (P0 → P1 → P2). Assumptions: production DB has migrations applied; RLS and grants are as in latest migrations; no manual trigger drops.

1. **[P0]** Run CLEANUP_QUICK_AUDIT.sql A) and B) monthly (or per release); fix any non-zero partition or orphan counts. **Rollback:** Drift fix migration is idempotent; orphan fix depends on plan (no delete without backup).
2. **[P0]** If calls_with_missing_session > 0: investigate match flow and session lifecycle; fix or backfill; do not delete call rows without product approval. **Rollback:** Restore from backup if backfill wrong.
3. **[P0]** If events_with_missing_session > 0: fix partition drift first (event.session_month = session.created_month); re-run audit. **Rollback:** Same as partition drift migration.
4. **[P1]** Document realtime source-of-truth (Redis vs DB, polling vs Realtime) in docs/REALTIME_SOURCE_OF_TRUTH.md. **Rollback:** N/A.
5. **[P1]** Add RPC response shape snapshot or link (get_recent_intents_v2, get_command_center_p0_stats_v2) to avoid breaking UI. **Rollback:** N/A.
6. **[P1]** Review use-realtime-dashboard and use-command-center-p0-stats polling intervals; consider 10s+ for activity fallback if 5min is acceptable. **Rollback:** Revert interval change.
7. **[P1]** Plan v2-only path: once v2 is default everywhere, remove get_recent_intents_v1 fallback from QualificationQueue and smoke scripts. **Rollback:** Re-add v1 fallback.
8. **[P2]** New migration: remove or guard get_dashboard_stats(uuid, int) revoke/grant in 20260131120000 (e.g. check pg_proc for that signature before executing). **Rollback:** Revert migration.
9. **[P2]** Audit all RPCs that take date ranges for half-open [from, to) consistency; fix any remaining BETWEEN for timestamps. **Rollback:** Per-migration.
10. **[P2]** Perf/smoke scripts: add optional TRT “today” range to match dashboard (e.g. env USE_TRT_TODAY=1). **Rollback:** N/A.
11. **[P2]** Audit useEffect/useCallback dependency arrays in use-command-center-p0-stats and use-realtime-dashboard for stale closures and loops. **Rollback:** Revert hook changes.
12. **[P2]** New relative-time or client-time elements: use suppressHydrationWarning or client-only render to avoid hydration mismatch. **Rollback:** Revert component change.
13. **[P2]** Keep CLEANUP_QUICK_AUDIT.md findings log updated when audit is run. **Rollback:** N/A.

**End of Cleanup Backlog.**

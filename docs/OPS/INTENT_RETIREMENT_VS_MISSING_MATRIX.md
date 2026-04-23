# Intent Retirement vs Missing Matrix

This matrix separates deliberate retirements from accidental runtime gaps.
Use it before writing any recovery migration.

## A) Intentionally retired (do not reintroduce)

| Surface | Evidence | Decision |
|---|---|---|
| `ingest_fallback_buffer` + fallback RPCs + `/api/cron/recover` + `lib/sync-fallback.ts` | `tests/architecture/phase4-ingest-fallback-drop.test.ts`, `app/api/sync/route.ts` Phase 4 note | Keep retired |
| Bitemporal `marketing_signals` (`sys_period`, `valid_period`, history table, time-travel RPC) | `tests/architecture/phase4-bitemporal-drop.test.ts` | Keep retired |
| `site_members` runtime path | runtime now uses `site_memberships` in auth/access files | Keep replaced by `site_memberships` |
| Physical `public.profiles` table | active compatibility uses `public.profiles` view (`00000000000005_profiles_compat_view.sql`) | Keep compatibility view model |

## B) Accidental missing / drift (restore or reconcile)

| Surface | Runtime expectation | Current state | Action |
|---|---|---|---|
| `increment_usage_checked` | called in `lib/ingest/sync-gates.ts` | not present in active migrations | Restore |
| `decrement_and_delete_idempotency` | called in `lib/ingest/execute-ingest-command.ts`; pinned in `tests/unit/workers-ingest-compensation.test.ts` | missing migration file and function | Restore |
| `site_plans` | queried in `lib/quota.ts` | missing in active migrations | Restore |
| `site_usage_monthly` | queried/upserted in `lib/quota.ts`, `lib/reconciliation.ts` | missing in active migrations | Restore |
| `usage_counters` | required by usage increment/decrement RPC semantics | missing in active migrations | Restore |
| `call_funnel_ledger` | inserted/read in funnel runtime and metrics routes | table DDL missing in active migrations | Restore |
| Drop migration `20260419180000_drop_ingest_fallback_buffer.sql` | pinned by architecture test | missing in repo migrations | Reconcile (add pinned artifact) |
| Drop migration `20260419170000_drop_bitemporal_marketing_signals.sql` | pinned by architecture test | missing in repo migrations | Reconcile (add pinned artifact) |
| PR4 migration `20260216000004_revenue_kernel_pr4_reconciliation_jobs.sql` | pinned by revenue gate test | missing in repo migrations | Reconcile (add pinned artifact) |

## C) Recovery safety rules

1. Never recreate retired fallback surfaces.
2. Rebuild only runtime-critical missing contracts.
3. If a test pins a historical migration filename, provide a compatible migration artifact instead of editing the test expectation.
4. Keep migration chain reproducible from clean state.

## D) Migration backlog order

1. Add missing pinned migration artifacts required by tests/contracts.
2. Add runtime recovery migration for quota + compensation + funnel ledger.
3. Re-run tests that pin these contracts.
4. Re-run smoke gate for intent end-to-end behavior.

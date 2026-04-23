# Intent Runtime Parity Matrix

This file is the runtime contract inventory for intent visibility and ingest continuity.
It compares:

- what runtime code calls
- what exists in active `supabase/migrations`
- what exists in canonical `schema.sql`

## Scope

- Ingest gates and compensation
- Quota/reconciliation surfaces
- Intent read/write RPC surfaces
- Funnel ledger write surface

## Contract Matrix

| Surface | Runtime code reference | Active migrations (`supabase/migrations`) | Canonical (`schema.sql`) | Status |
|---|---|---|---|---|
| `public.increment_usage_checked(uuid,date,text,int)` | `lib/ingest/sync-gates.ts` | Missing | Present | Gap (critical) |
| `public.decrement_and_delete_idempotency(...)` | `lib/ingest/execute-ingest-command.ts` | Missing | Missing in current canonical snapshot | Gap (critical) |
| `public.site_plans` | `lib/quota.ts` | Missing | Present | Gap (critical) |
| `public.site_usage_monthly` | `lib/quota.ts`, `lib/reconciliation.ts` | Missing | Present | Gap (critical) |
| `public.usage_counters` | implicit via `increment_usage_checked` | Missing | Present | Gap (critical) |
| `public.call_funnel_ledger` | `lib/domain/funnel-kernel/ledger-writer.ts`, `app/api/metrics/route.ts` | Missing | Missing in current canonical snapshot | Gap (critical) |
| `public.get_recent_intents_lite_v1(...)` | queue/dashboard APIs | Present (`00000000000007_runtime_recovery_rpcs.sql`) | Present | OK (verify behavior) |
| `public.get_dashboard_intents(...)` | `lib/hooks/use-site-config.ts` + dashboard flow | Present (`00000000000007_runtime_recovery_rpcs.sql`) | Present | OK (verify behavior) |
| `public.get_intent_details_v1(...)` | intent detail page/API | Present (`00000000000007_runtime_recovery_rpcs.sql`) | Present | OK |
| `public.get_activity_feed_v1(...)` | activity views/APIs | Present (`00000000000007_runtime_recovery_rpcs.sql`) | Present | OK |

## Behavior Risk Notes

1. `sync` can return accepted while downstream still fails.  
   Queue acceptance is not proof of `processed_signals -> events -> calls` writes.

2. Queue visibility is fail-closed in `get_recent_intents_lite_v1`.  
   If one row in the same `matched_session_id` is `junk/cancelled`, pending rows are hidden.

3. Compensation path currently calls an RPC that does not exist in active migrations.  
   This creates a retry/idempotency inconsistency risk on worker failures.

4. Quota path currently calls an RPC and tables that do not exist in active migrations.  
   This can short-circuit worker gates and suppress intent writes.

## Immediate Repair Order

1. `site_plans`, `site_usage_monthly`, `usage_counters`
2. `increment_usage_checked(...)`
3. `decrement_and_delete_idempotency(...)`
4. `call_funnel_ledger` (DDL + indexes + grants)
5. Re-verify `get_recent_intents_lite_v1` visibility semantics with live data

## Verification Queries (post-migration)

```sql
-- Function existence
select to_regprocedure('public.increment_usage_checked(uuid,date,text,integer)');
select to_regprocedure('public.decrement_and_delete_idempotency(uuid,date,text,text)');

-- Table existence
select to_regclass('public.site_plans');
select to_regclass('public.site_usage_monthly');
select to_regclass('public.usage_counters');
select to_regclass('public.call_funnel_ledger');
```

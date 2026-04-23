# Intent Recovery Canary and Rollback

This runbook is for incidents where `/api/sync` accepts traffic but intent cards are missing.

## Canary rollout order

1. **Single-site canary**
   - Run `npm run smoke:intent-worker-deps`
   - Run `P0_SITES="<canary-domain>" npm run smoke:intent-multi-site`
   - Confirm writes in this order: `processed_signals -> events -> calls`
   - Confirm queue RPC returns rows:
     - `get_recent_intents_lite_v1`
     - `get_dashboard_intents`

2. **Mandatory two-site gate**
   - `P0_SITES="yapiozmendanismanlik.com,sosreklam.com" npm run smoke:intent-multi-site`
   - Must be `2/2 PASS` before release.

3. **Target tenant verification**
   - `P0_SITES="www.kocotokurtarma.com" npm run smoke:intent-multi-site`
   - Confirm no `event_row_missing_no_processed_signals`.

## SQL verification set

```sql
-- Missing-contract checks
select to_regclass('public.site_plans');
select to_regclass('public.site_usage_monthly');
select to_regclass('public.usage_counters');
select to_regclass('public.call_funnel_ledger');
select to_regprocedure('public.increment_usage_checked(uuid,date,text,integer)');
select to_regprocedure('public.decrement_and_delete_idempotency(uuid,date,text,text)');
```

```sql
-- For one failing window (replace SITE_UUID)
select count(*) as ps
from public.processed_signals
where site_id = 'SITE_UUID'::uuid
  and created_at >= now() - interval '15 minutes';

select count(*) as ev
from public.events
where site_id = 'SITE_UUID'::uuid
  and created_at >= now() - interval '15 minutes';

select count(*) as ca
from public.calls
where site_id = 'SITE_UUID'::uuid
  and created_at >= now() - interval '15 minutes';
```

## Rollback boundaries

Use additive rollback boundaries first:

1. **Function rollback (safe first)**
   - Revert only `increment_usage_checked` and `decrement_and_delete_idempotency` definitions.
   - Keep tables untouched.

2. **Policy rollback (second)**
   - Revert only RLS policy changes if service-role writes are blocked unexpectedly.

3. **Table rollback (last resort)**
   - Do not drop runtime tables during incident unless confirmed unused.
   - Prefer `DISABLE` call paths in code before destructive DB rollback.

## Incident decision tree

1. `sync accepted` + no `processed_signals` -> worker delivery/auth path issue.
2. `processed_signals` exists + no `events/calls` -> gate or processing/RPC issue.
3. `calls` exists + queue empty -> visibility filter issue (same-session `junk/cancelled` shadowing first).

## Required logs to capture in postmortem

- `WORKERS_INGEST_GATE_REJECT`
- `WORKERS_INGEST_COMPENSATION_FAILED`
- `QSTASH_WORKER_ERROR`
- `qstash_publish_failed` response headers from `/api/sync`

## Exit criteria

- `smoke:intent-worker-deps` passes.
- Mandatory intent smoke is green (`2/2 PASS`).
- Target tenant smoke passes.
- Queue RPC and panel show intent rows for new test events.

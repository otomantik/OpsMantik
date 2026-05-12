# Marketing Signals Retirement Inventory

Queue-only hard retirement reference inventory and classification.

## rewrite_to_queue
- `app/api/oci/ack/route.ts`
- `app/api/oci/ack-failed/route.ts`
- `app/api/oci/queue-stats/route.ts`
- `app/api/oci/export-coverage/route.ts`
- `app/api/ops/stale-signals/route.ts` (GET: `requireCronAuth` — cross-site aggregate; not public)
- `app/api/cron/oci/recover-stuck-signals/route.ts`
- `lib/oci/outbox/process-outbox.ts`
- `lib/oci/maintenance/run-maintenance.ts`
- `lib/oci/preceding-signals.ts`
- `lib/oci/blocked-queue-metrics.ts`
- `lib/domain/mizan-mantik/stages/stage-router.ts`
- `lib/oci/backfill-precursor-signals.ts`
- `lib/domain/oci/queue-types.ts`
- `lib/admin/metrics.ts`

## delete_runtime_path
- `lib/oci/marketing-signal-dispatch-kernel.ts`
- `app/api/cron/oci/recover-stuck-signals/route.ts` (legacy compatibility path kept, behavior rewritten queue-only)
- `app/api/ops/stale-signals/route.ts` (legacy compatibility path kept, behavior rewritten queue-only; **auth:** `requireCronAuth`)

## drop_with_table
- `lib/domain/mizan-mantik/upsert-marketing-signal.ts`
- `lib/domain/mizan-mantik/insert-marketing-signal.ts`
- `lib/oci/upsert-marketing-signal.ts`
- `lib/oci/marketing-signal-hash.ts`
- `lib/oci/marketing-signal-value-ssot.ts`
- `lib/oci/vacuum-worker.ts`
- `lib/oci/pulse-recovery-worker.ts`
- `lib/oci/invalidate-pending-artifacts.ts`
- `app/api/cron/cleanup/route.ts` (legacy signal cleanup blocks)
- SQL/RPC objects in `supabase/migrations/*` referencing `marketing_signals`
- tests/scripts asserting `dispatch_status` behavior

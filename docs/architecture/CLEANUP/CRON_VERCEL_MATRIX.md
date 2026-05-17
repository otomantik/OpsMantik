# Vercel cron matrix vs `app/api/cron`

**Source of truth (schedules):** root [`vercel.json`](../../vercel.json).

When a handler is removed, delete the matching **Vercel Cron** entry in the dashboard or `vercel.json` to avoid 404 noise.

## Scheduled in `vercel.json` (production)

| Path | Schedule |
|------|----------|
| `/api/cron/watchtower` | `*/15 * * * *` |
| `/api/cron/reconcile-usage` | `*/15 * * * *` |
| `/api/cron/idempotency-cleanup` | `0 3 * * *` |
| `/api/cron/invoice-freeze` | `0 0 1 * *` |
| `/api/cron/oci-maintenance` | `*/10 * * * *` |
| `/api/cron/oci-recovery` | `*/30 * * * *` |
| `/api/cron/vacuum` | `*/10 * * * *` |
| `/api/cron/oci/process-outbox-events` | `*/5 * * * *` |
| `/api/cron/oci/ack-receipt-ttl` | `0 */6 * * *` |
| `/api/cron/oci/outbox-cleanup` | `15 3 * * *` |
| `/api/cron/truth-parity-repair` | `*/10 * * * *` |
| `/api/cron/funnel-projection` | `*/5 * * * *` |
| `/api/cron/auto-junk` | `0 2 * * *` |
| `/api/cron/oci/enqueue-from-sales` | `0 * * * *` |
| `/api/cron/cleanup` | `0 4 * * *` |
| `/api/cron/gdpr-retention` | `0 5 * * *` |

## Cron handlers present in repo but **not** in `vercel.json`

These may be invoked manually, via QStash, or legacy Vercel UI jobs — **verify before deleting**:

- `/api/cron/process-offline-conversions`
- `/api/cron/oci/attempt-cap`
- `/api/cron/oci/recover-stuck-signals`
- `/api/cron/oci/promote-blocked-queue`
- `/api/cron/oci/backfill-precursor-signals`
- `/api/cron/oci/sweep-zombies`
- `/api/cron/test-notification`
- `/api/cron/sweep-unsent-conversions`
- `/api/cron/providers/recover-processing`
- `/api/cron/providers/seed-credentials`
- `/api/cron/reconcile-usage/backfill`
- `/api/cron/reconcile-usage/run`
- `/api/cron/reconcile-usage/enqueue`

## Action checklist

1. Diff `vercel.json` against `Get-ChildItem -Recurse app/api/cron/**/route.ts`.
2. For each orphan schedule in Vercel UI: remove or document owner.
3. For each orphan handler: mark `legacy_unknown` in API inventory until owner confirms.

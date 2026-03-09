# TRT Cutoff DB Reset Runbook

## Scope

This runbook resets business data older than the TRT cutoff:

- Timezone: `Europe/Istanbul`
- Default cutoff: `yesterday 00:00 TRT`
- Scope: business runtime data only

Protected tables that are intentionally not part of this reset:

- `sites`
- `profiles`
- `site_members`
- `subscriptions`
- `site_plans`
- `site_usage_monthly`
- `usage_counters`
- `provider_credentials`
- `invoice_snapshot`
- `ad_spend_daily`

## Writer Freeze Checklist

Before running the destructive reset:

1. Pause Google Ads Apps Script triggers for every active site.
2. Pause or disable the mutating Vercel cron routes listed in `vercel.json`.
3. Do not run manual enqueue/recovery scripts concurrently with the reset.

High-priority mutating crons:

- `/api/cron/recover`
- `/api/cron/process-offline-conversions`
- `/api/cron/pulse-recovery`
- `/api/cron/providers/recover-processing`
- `/api/cron/oci/process-outbox-events`
- `/api/cron/oci/sweep-zombies`
- `/api/cron/sweep-unsent-conversions`
- `/api/cron/oci/enqueue-from-sales`
- `/api/cron/cleanup`
- `/api/cron/idempotency-cleanup`
- `/api/cron/auto-junk`

## Backup And Evidence

Required outside the repo:

1. Take a Supabase backup or PITR checkpoint.
2. Record the backup timestamp next to the cutoff used for the reset.

Recommended evidence commands before reset:

```powershell
node scripts/db/trt-cutoff-reset.mjs --dry-run
node scripts/db/oci-queue-check.mjs Eslamed
node scripts/db/oci-queue-check.mjs Muratcan
node scripts/db/oci-bugun-donusum-dokum-eslamed-muratcan.mjs --days 2
node scripts/db/oci-eslamed-aktivite-rapor.mjs --since 22
```

## Execute

Dry-run first:

```powershell
node scripts/db/trt-cutoff-reset.mjs --dry-run
```

Execute destructive reset:

```powershell
node scripts/db/trt-cutoff-reset.mjs --execute --force
```

Optional explicit cutoff:

```powershell
node scripts/db/trt-cutoff-reset.mjs --dry-run --cutoff "2026-03-06T21:00:00.000Z"
```

## Post Reset Verification

Required:

```powershell
npm run smoke:intent-multi-site
```

Recommended:

```powershell
npm run test:release-gates
node scripts/db/oci-queue-check.mjs Eslamed
node scripts/db/oci-queue-check.mjs Muratcan
```

OCI preview sanity:

```text
GET /api/oci/google-ads-export?siteId=<siteId>&markAsExported=false
```

## Notes

- The reset kernel is implemented in the database function `reset_business_data_before_cutoff_v1`.
- The CLI wrapper computes the TRT cutoff deterministically and calls the RPC using service role credentials.
- `marketing_signals` and `provider_dispatches` have delete guards; the reset kernel uses a maintenance-only session flag to bypass them during the reset transaction.

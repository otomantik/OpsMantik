# OCI SLI/SLO and Metabase Notes (L14 + Faz5)

## Core SLI Definitions

- `outbox_pending_age_p95`: p95 age of `outbox_events` rows where `status='PENDING'`.
- `notify_publish_fail_rate`: failed `notifyOutboxPending` / total notify attempts.
- `reconciliation_persist_fail_rate`: failed reconciliation persist / total reconciliation attempts.
- `primary_source_null_rate`: worker runs where click source missing / total processed.

## Suggested SLO Targets

- staging: `outbox_pending_age_p95 < 5m`
- production: `outbox_pending_age_p95 < 30m`
- `notify_publish_fail_rate < 1%` (cron recovery tolerated)
- `reconciliation_persist_fail_rate < 0.1%`

## Metabase Queries (minimum)

1. Pending age distribution by site.
2. Queue insert vs processed throughput by 5-minute bucket.
3. Reconciliation reason breakdown by day.
4. Outbox producer partial-failure counter trend.

## Alert Wiring

- Alert when pending age p95 breaches SLO for 2 consecutive windows.
- Alert when cron health check misses 2 runs.
- Alert when producer partial-failure metric spikes over historical baseline.

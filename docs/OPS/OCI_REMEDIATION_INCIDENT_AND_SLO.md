# OCI remediation — incident playbook and SLO draft

## Incident triggers

- `outbox_events` PENDING age p99 or max exceeds agreed threshold.
- Spike in `PROCESS_OUTBOX_ERROR` or cron `classification=error`.
- Spike in panel `503` with `OCI_PRODUCER_INCOMPLETE` when `OCI_PANEL_OCI_FAIL_CLOSED=true`.

## Response sequence

1. Check export-coverage / queue-stats admin endpoints.
2. Validate `CRON_SECRET` + Vercel cron headers (`lib/cron/require-cron-auth.ts` hybrid mode in production).
3. Validate QStash signing keys (`QSTASH_CURRENT_SIGNING_KEY`); worker 503 `QSTASH_KEYS_MISSING` pattern.
4. Review last deploy diff (migrations + app).
5. Use kill-switch lanes if present (`assertLaneActive`).
6. Postmortem: update `OPS_ARCHITECTURE_RED_TEAM_AUDIT.md` invariant row if a new gap was found.

## SLO thresholds (initial production baseline)

| Signal | Threshold | Severity |
|--------|-----------|----------|
| `outbox_events` max pending age | `> 10m` for 10 min | warning |
| `outbox_events` max pending age | `> 20m` for 5 min | critical |
| Worker failure ratio (`failed / (processed + failed)`) | `> 5%` for 15 min | warning |
| Worker failure ratio (`failed / (processed + failed)`) | `> 15%` for 10 min | critical |
| ACK `401`/`403` ratio | `> 2%` for 15 min | warning |
| ACK `401`/`403` ratio | `> 5%` for 10 min | critical |

Cron and worker responses expose `progress_made` and `classification` — dashboards and alerts must key on these instead of raw `ok`.

## Alarm → runbook mapping

- `pending_age_*` alerts -> check cron lock + QStash keys + worker health.
- `worker_failure_ratio_*` alerts -> inspect `PROCESS_OUTBOX_ERROR` + recent deploy diff.
- `ack_auth_ratio_*` alerts -> verify `OCI_ACK_REQUIRE_SIGNATURE`, `VOID_PUBLIC_KEY`, script signature rollout status.

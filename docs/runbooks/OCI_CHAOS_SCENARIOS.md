# OCI Chaos Scenarios (L8)

This runbook defines staging chaos drills for OCI producer/worker reliability.

Policy binding:
- `docs/OPS/OCI_CONVERSION_TIME_ZERO_TOLERANCE.md`

## Scenario Matrix

| Scenario | Injection | Expected | Abort |
|---|---|---|---|
| QStash full outage | break token / block publish | queue backlog grows, cron drains within SLO | pending age keeps rising |
| Cron auth broken | invalid `CRON_SECRET` | no processing, alert fires | no alert in 10m |
| Burst stage spam | same call staged 5x in 1s | dedupe + no logical duplicate card | duplicate visible cards |
| DB transient failure | inject 5xx for insert/claim | retry path and bounded fail-closed responses | silent success |

## Execution Steps

1. Baseline metrics (`pending_count`, `pending_age_p95`, `notify_fail_rate`).
2. Inject one scenario at a time for 5-10 minutes.
3. Validate route response semantics:
   - `oci_outbox_inserted`
   - `oci_enqueue_ok`
   - `oci_reconciliation_persisted`
4. Confirm recovery to baseline after rollback.

## Evidence

Capture:
- API responses
- watchtower snapshots
- SQL queue-age proof
- one-page incident notes with timestamps

# OCI SLI / SLO reference (L14)

**Purpose:** Observable definitions for OCI producer → outbox → worker → queue → script/ACK.  
**Policy:** Numeric SLO thresholds require product + infra sign-off; this document only names **what to measure** and where signals already exist.

## Core SLIs (from deep audit L14)

| SLI | Definition (example) | Existing signal (starting point) |
|-----|------------------------|----------------------------------|
| `outbox_pending_age_p95` | Age of `outbox_events` rows in `PENDING` — p95 | SQL / admin metrics; pair with cron `process-outbox` heartbeats |
| `reconciliation_persist_fail_rate` | `appendOciReconciliationEvent` failures / attempts | Counter `panel_stage_reconciliation_persist_failed_total` |
| `primary_source_null_rate` | Worker/producer paths where primary click resolution is empty when export was expected | Logs + `oci_producer_primary_window_drift_total` (optional recheck path) |
| `notify_publish_fail_rate` | QStash publish throws after outbox insert | `oci_notify_outbox_publish_failed_total` |
| `notify_skip_no_base_url_rate` | Missing absolute app URL — notify skipped (cron-only path) | `oci_notify_outbox_skipped_no_base_url_total` |

## Related counters (refactor metrics)

See [`lib/refactor/metrics.ts`](../../lib/refactor/metrics.ts): `panel_stage_outbox_insert_failed_total`, `oci_outbox_contract_violation_total`, `panel_stage_oci_producer_incomplete_total`, `oci_notify_outbox_publish_failed_total`, …

## Dashboard / Metabase

- Prefer **site_id** breakdown for queue and outbox SLIs (tenant blast-radius).
- Join **`outbox_events.payload.request_id`** to request logs when present ([`OCI_EXPORT_AND_TRACE_CORRELATION_ADR.md`](../architecture/OCI_EXPORT_AND_TRACE_CORRELATION_ADR.md)).

## Chaos / validation

Staging drill matrix: [`OCI_CHAOS_SCENARIOS.md`](./OCI_CHAOS_SCENARIOS.md).

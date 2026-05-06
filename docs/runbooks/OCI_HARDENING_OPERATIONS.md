# OCI Hardening Operations Runbook

This runbook covers the operational procedures for the OCI (Offline Conversion Import) hardening phase, specifically the rollout of strict fail-closed semantics for panel mutations and the necessary observability to maintain system health.

## 1. Canary-Ready Rollout Plan (`OCI_PANEL_OCI_FAIL_CLOSED`)

**Current Default Risk:** Currently, `OCI_PANEL_OCI_FAIL_CLOSED` defaults to `false`. This means if the OCI producer fails to persist a durable artifact (outbox row or reconciliation log), the HTTP mutation route still returns a `200 OK`. This creates a silent failure path.

To move to "hardened by default", we must switch this to `true`.

### Rollout Procedure (Canary)

1. **Enable for One Site / Staging First:**
   Set `OCI_PANEL_OCI_FAIL_CLOSED=true` in a staging environment or for a specific canary tenant if environment segmentation allows.
2. **Monitor `panel_oci_partial_failure_total`:**
   Watch this metric closely. If it spikes, it means the producer is failing to write to the database (e.g., due to connection limits or constraint violations).
3. **Monitor HTTP 503 Rates:**
   With fail-closed enabled, these partial failures will now manifest as `HTTP 503 Service Unavailable` on the dashboard.
4. **Rollback Procedure:**
   If user impact is severe and cannot be immediately diagnosed, roll back by setting `OCI_PANEL_OCI_FAIL_CLOSED=false` in the environment variables and redeploying/restarting.
5. **Criteria for Global Default True:**
   - Zero or near-zero `panel_oci_partial_failure_total` over a 7-day period under normal load.
   - All legacy `apply_call_action_v2` coercion bugs are verified fixed.

## 2. Observability Wiring & Critical Metrics

The following metrics must be actively monitored in production dashboards/alerts:

### 2.1 Outbox Health
- **Outbox PENDING Max Age:** The time since the oldest `PENDING` outbox event was created. Alerts should trigger if > 5 minutes.
- **PROCESSING Stuck Count:** Number of events in `PROCESSING` state for > 5 minutes (indicates worker crash or QStash timeout).
- **Worker `PROCESS_OUTBOX_ERROR` Rate:** Error rate from the outbox processor worker.

### 2.2 Producer & API Boundary Health
- **Panel Partial Failure Rate:** Tracks `panel_oci_partial_failure_total` (producer failed, but no fail-closed).
- **`oci_enqueue_ok=false` Count:** Total occurrences where the producer failed to enqueue an artifact.
- **Panel Fail Closed Total:** Tracks `panel_oci_fail_closed_total` (number of times users saw a 503 due to producer failure).

### 2.3 Ledger & Queue Health
- **`BLOCKED_PRECEDING_SIGNALS` Count:** Number of rows in the offline conversion queue blocked waiting for preceding marketing signals.
- **`BLOCKED` Max Age:** Alerts should trigger if blocked rows age beyond 24 hours (indicates stuck promotion).

### 2.4 Google Ads Sync Health
- **ACK Failed Rate:** Rate of failed acknowledgements from Google Ads scripts.
- **Google Upload Failed Rate:** Tracks explicit failures reported by the Apps Script.
- **`CONVERSION_ACTION_NOT_FOUND` Errors:** Tracks structural mismatches between the SSOT and Google Ads configuration.

## 3. Script-First OCI P0 Reliability Checks

Run these SQL packs during incident triage and pre-release checks:

1. `scripts/sql/rpc_contract_health.sql`
2. `scripts/sql/won_pipeline_health.sql`
3. `scripts/sql/script_backlog_health.sql`
4. `scripts/sql/value_integrity_health.sql`
5. `scripts/sql/identity_integrity_health.sql`

Projection contract note:
- `call_funnel_projection` is an active Funnel Kernel read-model table (analytics/metrics/ACK compatibility).
- `rebuild_call_projection` is expected to materialize/update one projection row per `(site_id, call_id)`.
- If `rpc_contract_health.sql` reports `projection_exists=false`, classify as schema drift and apply missing projection-table migration before continuing.

### 3.1 Incident Classification

- **Drift:** `rpc_contract_health.sql` reports missing/signature-drifted RPCs or unsafe grants.
- **Won leak:** `won_pipeline_health.sql` shows `won_missing_pipeline > 0` and non-zero `leak_rate`.
- **Backlog:** `script_backlog_health.sql` shows growing active queue ages/retry counts.
- **Value integrity:** `value_integrity_health.sql` shows abnormal fallback ratio or suspicious zero/null value rows.
- **Identity integrity:** `identity_integrity_health.sql` shows malformed/missing phone hash anomalies.

### 3.2 Stabilization Sequence

1. Freeze risky rollout changes (no API-mode promotion while P0 checks are red).
2. Keep script-mode active.
3. Run `scripts/sql/orphan_won_backfill.sql` in dry-run mode and classify candidates.
4. Repair via existing enqueue SSOT path (`enqueueSealConversion` / sweep cron).
5. Re-run health packs until `won_missing_pipeline = 0` and leak rate is `0`.

### 3.3 Rollback Principles

- Do not promote API mode when P0 checks are red.
- Do not delete `offline_conversion_queue` rows during mitigation.
- Prefer additive migrations and deterministic replay over destructive cleanup.

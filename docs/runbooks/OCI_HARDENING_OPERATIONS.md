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

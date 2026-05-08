---
status: active
---

# OCI Hardening Operations Runbook

This runbook covers the operational procedures for the OCI (Offline Conversion Import) hardening phase, specifically the rollout of strict fail-closed semantics for panel mutations and the necessary observability to maintain system health.

Canonical upload authority for Google batch remains **queue-only**: `GET /api/oci/google-ads-export` reads `offline_conversion_queue` only. `marketing_signals` is legacy/audit/recovery support and not an independent upload source.

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
- **`BLOCKED_PRECEDING_SIGNALS` Count:** Number of rows in the offline conversion queue blocked waiting for preceding conversion evidence (queue-first; legacy `marketing_signals` consult may remain for compatibility).
- **`BLOCKED` Max Age:** Alerts should trigger if blocked rows age beyond 24 hours (indicates stuck promotion).

### 2.4 Google Ads Sync Health
- **ACK Failed Rate:** Rate of failed acknowledgements from Google Ads scripts.
- **Google Upload Failed Rate:** Tracks explicit failures reported by the Apps Script.
- **`CONVERSION_ACTION_NOT_FOUND` Errors:** Tracks structural mismatches between the SSOT and Google Ads configuration.

### 2.5 Queue lifecycle vs Queue Health 100
- **SSOT doc:** [OCI_QUEUE_LIFECYCLE_CONTRACT.md](../architecture/OCI_QUEUE_LIFECYCLE_CONTRACT.md) — allowed/forbidden transitions, ACK vs ledger-safe writers, `UPLOADED` / `DEAD_LETTER_QUARANTINE` semantics.
- **PR-1C taxonomy:** `FAILED` on the queue is a **state**, not always a provider outage. `DETERMINISTIC_SKIP` + `SUPPRESSED_BY_HIGHER_GEAR` is an **expected** non-upload terminal when lower gears are suppressed; it must remain **visible** in metrics but must **not** drive `provider_failed_rate` / `actionable_failed_rate` alone. Treat **unclassified** FAILED rows (`unknown_failed_count`) as dangerous until triaged.
- **Binding to health “100”:** elevated retry rate, non-zero DLQ, **won pipeline leak**, or **stuck `PROCESSING`** must be interpreted together with lifecycle rules (illegal rewinds, missing ACK receipt idempotency, export-claim mismatch). If `queue_health_score` is GREEN but DB shows long-lived `PROCESSING` without `recover_stuck_offline_conversion_jobs` clearing them, treat as **false green** until TARGET_DB reconciles.
- **False-green ban:** Do not assert perfect queue health from release markdown alone; require `db_evidence_status` / SQL health packs from [OCI_QUEUE_HEALTH.md](../architecture/OCI_QUEUE_HEALTH.md) when claiming production readiness.

### 2.6 Historical rows (no automatic repair in PR-1C)
Older environments may still have rows **`COMPLETED`** with `provider_error_code = SUPPRESSED_BY_HIGHER_GEAR` from before PR-1B. **This PR does not migrate or fix them.** If cleanup is required, run a **separate ops-only** repair with site scope, candidate preview, `CHANGE_TICKET`, `OPERATOR_ID`, an explicit **`--write`** guard, and **no queue row deletion** — mirror the discipline in hardening playbooks; do not ship destructive migrations for this.

## 3. Script-First OCI P0 Reliability Checks

Run these SQL packs during incident triage and pre-release checks:

1. `scripts/sql/rpc_contract_health.sql`
2. `scripts/sql/won_pipeline_health.sql`
3. `scripts/sql/script_backlog_health.sql`
4. `scripts/sql/value_integrity_health.sql`
5. `scripts/sql/identity_integrity_health.sql`
6. `scripts/sql/queue_health.sql` — per-site operational queue invariants (`queue_health_contract_v1`); PR-1C adds taxonomy columns (`deterministic_skip_count`, `actionable_failed_rate`, `provider_failed_rate`, `unknown_failed_count`, …) so deterministic skips are visible but gated separately from provider failures; complements rollout script thresholds in [`lib/oci/queue-health-contract.ts`](../../lib/oci/queue-health-contract.ts).

**Queue health vs conversion economics:** [`queue_health_score`](../../lib/oci/queue-health-contract.ts) is not `lead_score` / conversion value — see [OCI_QUEUE_HEALTH.md](../architecture/OCI_QUEUE_HEALTH.md).

**Future work (separate PRs — do not mix with contract-only releases):** poison-pill / HoL isolation for bad payloads, exponential backoff + jitter on retries, DLQ “autopsy” grouped reports — behavior-changing; tracked outside the measurement contract PR.

Projection contract note:
- `call_funnel_projection` is an active Funnel Kernel read-model table (analytics/metrics/ACK compatibility).
- `rebuild_call_projection` is expected to materialize/update one projection row per `(site_id, call_id)`.
- If `rpc_contract_health.sql` reports `projection_exists=false`, classify as schema drift and apply missing projection-table migration before continuing.

### 3.1 Incident Classification

- **Drift:** `rpc_contract_health.sql` reports missing/signature-drifted RPCs or unsafe grants.
- **Won leak:** `won_pipeline_health.sql` shows `won_missing_pipeline > 0` and non-zero `leak_rate`.
- **Backlog:** `script_backlog_health.sql` shows growing active queue ages/retry counts (Google upload truth). `marketing_signals_pending_count` is legacy/audit pressure unless explicitly promoted by separate policy.
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

### 3.4 Export Run Integrity

The export run operates under strict rules defined in [OCI_EXPORT_RUN_INTEGRITY_CONTRACT.md](../architecture/OCI_EXPORT_RUN_INTEGRITY_CONTRACT.md).

- **QUEUE_CLAIM_MISMATCH**: This is thrown (HTTP 409) if `fetched_count != claimed_count`. It means another instance grabbed the row, or the row status changed mid-flight. **Action:** Safe to ignore occasionally. If persistent, investigate overlapping script schedules or cron concurrency.
- **EXPORT_RUN_INTEGRITY_UNVERIFIED**: Release evidence will show this until structured logs (`export_run_id`) perfectly connect the script payload summaries with the DB ACKs. **Action:** It means we cannot definitively prove partial run failures aren't happening, but we aren't explicitly failing either.
- **EXPORT_RUN_INTEGRITY_PARTIAL**: Script summary provided evidence for some equations (e.g. Eq B or C) but missing data prevents full run reconciliation. **Action:** Investigate script summary drops.
- **EXPORT_RUN_INTEGRITY_RED**: A definitive failure in script summary validation (e.g. `SCRIPT_SUMMARY_INVALID`) or an equation mismatch (e.g. `SCRIPT_CLASSIFICATION_MISMATCH`, `ACK_TOTAL_MISMATCH`). **Action:** This indicates a pipeline bug or an external intervention modifying counts mid-flight.
- **Script Summary Validation (`SCRIPT_SUMMARY_INVALID`)**: Sent by PR-3D endpoint when a script payload does not match schema requirements. Maps to `RED` integrity.
- **Investigating Stuck PROCESSING:** If rows are stuck in `PROCESSING` longer than script execution time, the script crashed post-claim or the ACK endpoint was unreachable. **Action:** `recover_stuck_offline_conversion_jobs` (sweep cron) will safely revert them to `RETRY`. Do NOT manually change statuses.
- **ACK Endpoint Outage:** If the Google upload succeeds but the `opsmantik/ack` route is down, rows leak into `PROCESSING` and eventually get swept to `RETRY`. **Action:** This leads to a duplicate upload attempt to Google on the next run. This is acceptable under the **at-least-once transport + idempotent commit** model (Google Ads uses orderId deduplication).
- **Why exactly-once isn't assumed:** Network partitions mean we can never guarantee script ↔ backend ACKs complete perfectly. We rely on deterministic IDs (`external_id`) and idempotent DB RPCs to self-heal.
- **Correlating Lineage:** Search structured logs for `export_run_id`. It ties together `EXPORT_RUN_FETCHED`, `EXPORT_RUN_CLAIMED`, `EXPORT_RUN_RESPONSE_BUILT`, `EXPORT_RUN_ACK_RECEIVED`, and `SCRIPT_SUMMARY_RECEIVED`. This ID is strictly for debugging lineage and has no effect on actual conversion identity.


## 4. Conversion Math SSOT and Value Drift

Canonical conversion names:
- `OpsMantik_Contacted`
- `OpsMantik_Offered`
- `OpsMantik_Won`
- `OpsMantik_Junk_Exclusion`

Canonical policy module:
- `lib/oci/marketing-signal-value-ssot.ts`

Policy version:
- `oci_conversion_value_policy_v1`

Run value drift checks:
1. `scripts/sql/value_integrity_health.sql`
2. `scripts/sql/conversion_value_policy_repair_playbook.sql` (dry-run candidates)

GREEN/RED interpretation:
- GREEN: `drifted_rows = 0` for active sites.
- RED: any non-waived drift rows > 0.

Dry-run repair flow:
1. Run playbook dry-run and pick one site as canary.
2. Repair through app SSOT paths when possible (enqueue/upsert flows).
3. If emergency write is unavoidable, tag provenance fields (`value_repair_reason`, `value_policy_version`, `value_repaired_at`, `value_repaired_by`).
4. Re-run health SQL and verify drift is cleared.

Hard rules:
- Never delete queue rows during mitigation.
- Value policy changes must ship as one PR containing code + migration + health SQL + tests.

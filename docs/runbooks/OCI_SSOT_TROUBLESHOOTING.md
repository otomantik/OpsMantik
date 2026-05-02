# OCI SSOT troubleshooting

**Preflight + matematik:** [`docs/OPS/OCI_CONVERSION_MATH_AND_PREFLIGHT.md`](../OPS/OCI_CONVERSION_MATH_AND_PREFLIGHT.md) — invariant’lar, claim filtresi, backfill zaman kuralları, deploy checklist.

Follow this order when conversions look wrong in Google Ads or in OpsMantik OCI Control.

## 1. Click ID on the call

- Confirm the sealed call has a usable `gclid`, `wbraid`, or `gbraid` (direct session or stitch). Without a click ID, **won** never enters `offline_conversion_queue`, and **marketing_signals** upserts skip with canonical reason `NO_ADS_CLICK_ID` (recorded in `oci_reconciliation_events` when applicable; legacy label `missing_click_ids` may appear in older telemetry).
- Panel mutations follow a strict producer identity: each successful mutation must leave either a new `outbox_events` row or an idempotent `oci_reconciliation_events` row with explicit reason (`NO_MATCHED_SESSION`, `SESSION_NOT_FOUND`, `NO_ADS_CLICK_ID`, `TEST_CLICK_ID`, `NOT_EXPORTABLE_STAGE`, `OUTBOX_INSERT_FAILED`).

## 2. Precursor marketing signals (ordering)

- **OpsMantik_Contacted** and **OpsMantik_Offered** rows in `marketing_signals` must leave blocking dispatch states (`PENDING`, `PROCESSING`, `STALLED_FOR_HUMAN_AUDIT`) before **OpsMantik_Won** is exported.
- Historically missing signals use **`planPrecursorBackfillStages`** (`lib/oci/precursor-backfill-plan.ts`): **ledger** time per stage when present; if the ledger has *some* events but not every stage required by `calls.status`, missing stages use **hybrid** (`call_snapshot_hybrid`) with `confirmed_at` / `created_at` — not job `NOW()`; if the ledger is **empty** for the call, **full fallback** (`call_snapshot_fallback`). Conversion time is never the backfill job’s wall-clock `NOW()`.
- If precursors are still blocking, the won row stays in **`BLOCKED_PRECEDING_SIGNALS`** with `block_reason` set (for example `PRECEDING_SIGNALS_NOT_EXPORTED`).
- Cron **`/api/cron/oci/promote-blocked-queue`** promotes blocked rows to **`QUEUED`** when precursors are ready (ledger-safe transition).

## 3. Export queue vs script/API fetch

- Script/API export only pulls **`offline_conversion_queue`** rows in **`QUEUED`** or **`RETRY`**.
- **`BLOCKED_PRECEDING_SIGNALS`** is intentionally excluded until promotion.

## 4. Marketing signals export path

- Pending signals use `marketing_signals.dispatch_status = 'PENDING'` until claimed and ACKed. Use OCI Control summary **Signals PENDING** and dispatch breakdown from **`GET /api/oci/queue-stats`**.

## 5. ACK and terminal states

- After upload, ACK routes move rows to **`COMPLETED`** / signal **`SENT`**. Failed ACK paths mark **`FAILED`** / **`COMPLETED_UNVERIFIED`** per existing contracts.

## 6. Drain path and lock behavior

- Deterministic manual drain should target **worker path**: `POST /api/workers/oci/process-outbox` with `Authorization: Bearer CRON_SECRET` and `x-opsmantik-internal-worker: 1`.
- Cron endpoint (`/api/cron/oci/process-outbox-events`) remains safety net. `lock_held` there is expected when another run owns the lock; for deterministic drain use worker-first scripts.

## SSOT tables (mental model)

| Concern | Primary table |
|--------|----------------|
| Won conversion payload & export ordering | `offline_conversion_queue` |
| Stage-level conversions (contacted/offered) | `marketing_signals` |
| Skip / audit for SSOT gaps | `oci_reconciliation_events` |
| Funnel timeline (contacted/offered/won events) | `call_funnel_ledger` |
| Queue row transitions / snapshot | `oci_queue_transitions` + `apply_snapshot_batch` |

## Useful endpoints (authenticated)

- `GET /api/oci/queue-stats?siteId=...` — queue totals, stuck processing, signal dispatch breakdown, oldest blocked timestamp.
- `GET /api/oci/export-coverage?siteId=...` — compact SSOT snapshot + reconciliation event volume (24h).
- `GET /api/oci/export-coverage?siteId=...&window=last_1h|last_24h|last_7d` — reconciliation reason distribution by time window.

## Operational cron (secured)

- `GET /api/cron/oci/promote-blocked-queue` — promote blocked won rows when precursors are ready.
- `GET /api/cron/oci/backfill-precursor-signals?siteId=...&limit=50&dry_run=1` — optional gap fill for missing contacted/offered signals (dry-run first).

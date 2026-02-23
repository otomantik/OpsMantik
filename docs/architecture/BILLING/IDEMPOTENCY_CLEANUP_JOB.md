# Idempotency Cleanup Job

**Endpoint:** `POST /api/cron/idempotency-cleanup`  
**Schedule:** Daily 03:00 UTC (Vercel Cron)  
**Auth:** CRON_SECRET

---

## 1. Goal

Maintain the `ingest_idempotency` table size by removing rows older than the retention window. Deletes are **batched** (max 10,000 rows per run) to avoid timeouts.

## 2. Retention Policy

**Retention Period:** 90 days.

- Rows with `created_at` older than 90 days are **eligible for deletion**.
- Rows in the **current UTC month** or **previous UTC month** are **never** deleted (safety for dispute/invoice).

## 3. Safety Mechanisms

1.  **Cutoff validation:** Cutoff is strictly 90 days ago (> 89 days).
2.  **Month guard:** RPC `delete_expired_idempotency_batch` only deletes rows where `year_month <= (current_utc_month - 2)`. Current and previous month are never touched.
3.  **Batch limit:** At most 10,000 rows deleted per run (configurable in RPC).
4.  **Dry run:** `?dry_run=true` returns `would_delete` count; no rows are deleted.
5.  **Fail-secure:** DB errors return 500; each batch is transactional.

## 4. Response

- **dry_run=true:** `{ ok, cutoff, would_delete, dry_run: true, note? }`. If `would_delete` > 10k, `note` suggests multiple runs.
- **dry_run=false:** `{ ok, cutoff, deleted, batch_size: 10000, note? }`. If `deleted === batch_size`, backlog may remain; run again or schedule more frequently.

## 5. Runbook for Large Backlog

If the table has grown (e.g. cleanup was paused):

1.  Call with `?dry_run=true` to see `would_delete`.
2.  If `would_delete` > 10k, run the cron **multiple times** (e.g. daily or twice daily). Each run removes up to 10k rows.
3.  No manual SQL needed; the endpoint uses the RPC `delete_expired_idempotency_batch`.

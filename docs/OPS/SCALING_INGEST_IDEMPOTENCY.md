# Scaling ingest_idempotency — Runbook

**Purpose:** When and how to scale the `ingest_idempotency` table (partitioning, BRIN, cleanup). No code changes in this doc; implementation lives in migrations and PR-9 when applied.

---

## 1. When to consider partitioning or indexing

Consider partitioning or BRIN when **any** of the following is true:

| Signal | Threshold | Action |
|--------|-----------|--------|
| **Row count** | `ingest_idempotency` > ~5–10M rows | Plan partitioning (PR-9) or add BRIN. |
| **Reconciliation duration** | `reconcile-usage` run (per job or total) consistently > 2–5 min | Check EXPLAIN on `COUNT(*) ... WHERE site_id = ? AND year_month = ? AND billable = true`; add partition or BRIN if seq scan. |
| **Cleanup duration** | `idempotency-cleanup` times out (e.g. Vercel 60s) | Already mitigated by batch delete (10k/run); schedule more frequent runs or add partition so cleanup targets one partition at a time. |
| **Dispute export** | Export for one site/month > 30s | Ensure index on `(site_id, year_month)`; partition by month helps partition pruning. |

Current state (as of this runbook):

- **Table:** Single table, no partition. PK `(site_id, idempotency_key)`.
- **Indexes:** `idx_ingest_idempotency_expires_at`, `idx_ingest_idempotency_site_year_month_billable`, `idx_ingest_idempotency_site_year_month_billing_billable` (partial).
- **Cleanup:** Batch delete via RPC `delete_expired_idempotency_batch(cutoff, 10000)`; never deletes current/previous month.

---

## 2. PR-9 design summary (target state)

Two options when scaling is required:

### Option A: RANGE partitioning by month

- **Partition key:** `created_at` (or derived month). Partitions named e.g. `ingest_idempotency_2026_01`, `ingest_idempotency_2026_02`.
- **PK:** May need to include partition key for uniqueness (e.g. `(site_id, idempotency_key, created_at)`) depending on Postgres version and constraint rules.
- **Benefits:** Reconciliation and dispute-export queries that filter by `year_month` (or `created_at` range) can use partition pruning. Cleanup can drop or truncate entire partitions for months older than retention (optional, in addition to or instead of batch delete).
- **Migration path:** New partitioned table → backfill from current table (in batches, with lock strategy) → swap names → application uses new table. See §4.

### Option B: BRIN on `created_at`

- **Index:** `CREATE INDEX ... ON ingest_idempotency USING BRIN (created_at);`
- **Benefits:** Small index size; good for append-mostly, time-ordered data. Helps range scans on `created_at` (cleanup, exports).
- **When to use:** If you want a low-risk change first without a full partition migration. Less effective than partitioning if the table is updated heavily (e.g. `billable` / `billing_state` updates).

---

## 3. Migration steps (Option A — partitioning)

1. **Create partitioned table** (e.g. `ingest_idempotency_new`) with same columns and RLS; partition by month (RANGE on `created_at` or on `date_trunc('month', created_at)`).
2. **Create partitions** for current month and next month (and optionally backfill months). Ensure a maintenance job or trigger creates next month’s partition (e.g. `ingest_idempotency_ensure_next_partition()`).
3. **Backfill:** Copy data from `ingest_idempotency` to `ingest_idempotency_new` in batches (e.g. by `created_at` ranges or by partition). Prefer low-traffic window; use `SELECT ... LIMIT N` and repeat to avoid long locks. Optionally use a lock to block new inserts during final cutover.
4. **Swap:** Rename `ingest_idempotency` → `ingest_idempotency_old`, `ingest_idempotency_new` → `ingest_idempotency`. Update any FKs or views if applicable. Application restarts or picks up the new table on next request.
5. **Reconciliation / dispute-export:** Ensure queries use `year_month` or `created_at` range so partition pruning applies. No app code change if they already filter by `site_id` + `year_month`.
6. **Cleanup:** Either keep using `delete_expired_idempotency_batch` on the partitioned table (deletes from multiple partitions) or add a step to DROP old monthly partitions instead of row-by-row delete (faster for full-month retention).

---

## 4. Rollback

- **Before swap:** Drop `ingest_idempotency_new` and keep the original table; no rollback of app.
- **After swap:** Rename tables back: `ingest_idempotency` → `ingest_idempotency_new`, `ingest_idempotency_old` → `ingest_idempotency`. Restore app to previous version if it had partition-specific logic. Data written to the new table during the short window may need to be merged back or accepted as acceptable loss (e.g. idempotency keys re-inserted on retry).

---

## 5. How cleanup interacts with partitioning

- **Current (no partition):** Cleanup uses `delete_expired_idempotency_batch(cutoff, 10000)`. RPC deletes only rows with `created_at < cutoff` and `year_month <= (current_utc_month - 2)`.
- **With partitions:** Same RPC works on a partitioned table (deletes from matching partitions). Alternatively, for monthly partitions you can **DROP PARTITION** for months older than retention (e.g. drop `ingest_idempotency_2025_05` when retention is 90 days and current month is 2026-02). That is faster than row delete but requires a separate cron or migration step that drops by partition name. Prefer keeping the batch-delete RPC for consistency and safety (no accidental drop of current/previous month).

---

## 6. References

- **Migrations:** `supabase/migrations/20260214000000_ingest_idempotency_and_fallback.sql`, `20260216000000_revenue_kernel_pr1.sql`, `20260217000000_idempotency_cleanup_batch_rpc.sql`.
- **Cleanup:** `POST /api/cron/idempotency-cleanup`; `docs/BILLING/IDEMPOTENCY_CLEANUP_JOB.md`.
- **PR-9 (when applied):** Evidence doc references `20260217000000_pr9_ingest_idempotency_partitioning.sql` and `docs/BILLING/PR9_IDEMPOTENCY_SCALING.md` as the detailed migration plan.

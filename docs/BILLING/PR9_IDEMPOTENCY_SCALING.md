# PR-9: ingest_idempotency scaling plan

**Date:** Feb 2026  
**Goal:** Scale `ingest_idempotency` for high ingest volume and efficient cleanup/reconciliation.

---

## Options

| Option | Description | When to use |
|--------|-------------|-------------|
| **A** | Monthly partitioning by `RANGE(created_at)` | Preferred: table large or expected to grow; enables partition pruning and fast monthly drop. |
| **B** | BRIN on `created_at` + existing partial indexes | If partitioning is postponed; improves time-ordered scans. |

---

## Option A: Monthly partitioning (preferred)

### Design

- **Partition key:** `created_at` (PostgreSQL does not allow generated columns as partition key; `year_month` is generated, so we use `created_at`).
- **Partitioning:** `PARTITION BY RANGE (created_at)` with one partition per calendar month (UTC).
- **Primary key:** `(site_id, idempotency_key, created_at)` so the unique constraint includes the partition key (required by PostgreSQL). Uniqueness of `(site_id, idempotency_key)` is still enforced per partition; logically one key exists only once.
- **Indexes:** Same as current (expires_at, site_id+year_month+billable, etc.); created on parent and propagated to partitions.

### Migration (minimal downtime)

**File:** `supabase/migrations/20260217000000_pr9_ingest_idempotency_partitioning.sql`

1. Create new partitioned table `ingest_idempotency_new` with same columns and PK `(site_id, idempotency_key, created_at)`.
2. Create partitions for every month from (oldest row month) through (current + 12 months).
3. Create indexes, RLS, policies, grants on `ingest_idempotency_new`.
4. **Lock** `ingest_idempotency` (ACCESS EXCLUSIVE), copy all rows into `ingest_idempotency_new`, then:
   - `ALTER TABLE ingest_idempotency RENAME TO ingest_idempotency_pr9_backup`
   - `ALTER TABLE ingest_idempotency_new RENAME TO ingest_idempotency`
5. Rename policy to `ingest_idempotency_select_site_members`.

**Downtime:** Duration of the lock (copy time). No application code change; INSERT/UPDATE/SELECT by `(site_id, idempotency_key)` unchanged.

### Partition maintenance

Run **monthly** (pg_cron or external cron):

```sql
SELECT public.ingest_idempotency_ensure_next_partition();
```

Creates the next month’s partition if missing (idempotent).

### Rollback (Option A)

If you need to revert to the non-partitioned table:

1. **Stop** or avoid writes to `ingest_idempotency` (e.g. maintenance window).
2. Swap back:
   ```sql
   ALTER TABLE public.ingest_idempotency RENAME TO ingest_idempotency_partitioned;
   ALTER TABLE public.ingest_idempotency_pr9_backup RENAME TO ingest_idempotency;
   ```
3. After verification, drop the partitioned table:
   ```sql
   DROP TABLE public.ingest_idempotency_partitioned;
   ```

The backup table is the original table (PK `(site_id, idempotency_key)`); no schema change needed after rename.

---

## Option B: BRIN fallback (if partitioning postponed)

**File:** `supabase/migrations/20260217000001_pr9_ingest_idempotency_brin_fallback.sql`

- Adds BRIN index on `created_at` (`pages_per_range = 32`).
- Safe on current non-partitioned table or on partitioned parent (index propagates).
- Existing partial indexes (PR-1/PR-2) already cover:
  - `(site_id, year_month)` WHERE billable = true
  - `(site_id, year_month, billing_state)` WHERE billable = true
  - `(site_id, year_month, idempotency_version)` WHERE billable = true

---

## Query plans (EXPLAIN)

Run against the **partitioned** table (Option A) for partition pruning; plans for the non-partitioned table are similar but without “Partition Prune” steps.

### 1) Insert (API path)

```sql
EXPLAIN (ANALYZE, COSTS OFF, FORMAT TEXT)
INSERT INTO public.ingest_idempotency (site_id, idempotency_key, created_at, expires_at, idempotency_version)
VALUES (
  '00000000-0000-0000-0000-000000000001'::uuid,
  'sha256:abc',
  NOW(),
  NOW() + INTERVAL '90 days',
  1
);
```

**Expected (partitioned):** Insert into a single partition; no scan. No EXPLAIN output for INSERT in some versions; plan shows routing to one partition.

### 2) Select by site_id + year_month (reconciliation count)

```sql
EXPLAIN (ANALYZE, COSTS OFF, FORMAT TEXT)
SELECT COUNT(*) FROM public.ingest_idempotency
WHERE site_id = '00000000-0000-0000-0000-000000000001'
  AND year_month = '2026-02'
  AND billable = true;
```

**Expected (partitioned):** Partition pruning to the matching month partition(s); Index Scan or Bitmap Index Scan on `idx_ingest_idempotency_*_site_year_month_billable` (or equivalent) on that partition.

**Example (conceptual):**

```
Aggregate
  -> Index Scan using idx_ingest_idempotency_*_site_year_month_billable on ingest_idempotency_2026_02
        Index Cond: (site_id = ... AND year_month = '2026-02')
        Filter: (billable = true)
```

### 3) Update by site_id + idempotency_key (quota reject / overage)

```sql
EXPLAIN (ANALYZE, COSTS OFF, FORMAT TEXT)
UPDATE public.ingest_idempotency
SET billable = false
WHERE site_id = '00000000-0000-0000-0000-000000000001'
  AND idempotency_key = 'sha256:abc';
```

**Expected (partitioned):** Without `created_at` in the WHERE clause, the planner may scan the partition(s) that could contain the row (e.g. current month). Update touches one partition; Index Scan or Seq Scan on that partition using PK or unique lookup.

### 4) Cleanup by expires_at (TTL delete)

```sql
EXPLAIN (ANALYZE, COSTS OFF, FORMAT TEXT)
DELETE FROM public.ingest_idempotency
WHERE expires_at < NOW();
```

**Expected (partitioned):** Partition pruning to partitions that can contain rows with `expires_at < NOW()` (typically older partitions). Index Scan on `idx_ingest_idempotency_expires_at` (or BRIN if Option B) on those partitions. With Option A, old partitions can be dropped instead of bulk DELETE for minimal downtime.

### 5) Distinct site_id in range (backfill enqueue)

```sql
EXPLAIN (ANALYZE, COSTS OFF, FORMAT TEXT)
SELECT DISTINCT site_id FROM public.ingest_idempotency
WHERE year_month >= '2026-01' AND year_month <= '2026-03'
LIMIT 50000;
```

**Expected (partitioned):** Partition pruning to the three months; Index Only Scan or Bitmap Heap Scan on the partial indexes that include `(site_id, year_month)` in the pruned partitions.

---

## Summary

| Deliverable | Location |
|-------------|----------|
| Option A migration | `supabase/migrations/20260217000000_pr9_ingest_idempotency_partitioning.sql` |
| Option B migration | `supabase/migrations/20260217000001_pr9_ingest_idempotency_brin_fallback.sql` |
| Partition maintenance | `ingest_idempotency_ensure_next_partition()` (run monthly) |
| Query plans | This doc (EXPLAIN examples above) |
| Rollback | Swap table names and drop partitioned table (see Rollback section) |

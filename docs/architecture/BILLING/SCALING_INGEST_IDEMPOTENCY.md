# Scaling Runbook: Ingest Idempotency

**Table:** `ingest_idempotency`  
**Purpose:** Revenue Kernel Source of Truth (SoT). Guaranteed unique processing of billable events.

---

## 1. Current Architecture (v2.1)

- **Structure:** Composite Primary Key `(site_id, idempotency_key)`.
- **Partitioning:** None (Single Heap Table).
- **Index:** `idx_ingest_idempotency_expires_at` (B-Tree).
- **Growth Rate:** ~1 KB per row (indexes included).

### Thresholds for Action

| Metric | Warning Limit | Action Limit | Impact |
| :--- | :--- | :--- | :--- |
| **Table Size** | 10 GB | 100 GB | Vacuum/Autovacuum lag; slower inserts. |
| **Row Count** | 50M Rows | 250M Rows | Index bloat; cache thrashing. |
| **Insert Latency** | > 100ms (p99) | > 500ms (p99) | Ingestion backpressure; 500 errors. |

---

## 2. Partitioning Strategy (The 10x Plan)

When thresholds are breached, migration to **Native Partitioning** is required.

**Strategy:** Range Partitioning by `created_at`.
**Why:**
- Queries are almost always time-bound (`created_at > NOW() - 90 days`).
- Cleanup (DROP PARTITION) is instant vs. expensive `DELETE` rows.

### Migration Plan (Zero Downtime)

1.  **Create Parent Table:**
    ```sql
    CREATE TABLE ingest_idempotency_next (LIKE ingest_idempotency INCLUDING ALL)
    PARTITION BY RANGE (created_at);
    ```

2.  **Create Partitions:**
    ```sql
    CREATE TABLE ingest_idempotency_y2026m02
    PARTITION OF ingest_idempotency_next
    FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
    -- Pre-create 3 months ahead
    ```

3.  **Dual Write (Application Layer):**
    - Update `app/api/sync/route.ts` to write to BOTH tables.
    - Reader continues to read old table.

4.  **Backfill:**
    - Copy data from old to new (batches).

5.  **Cutover:**
    - Point readers to new table.
    - Stop writing to old table.
    - Rename tables (`next` -> `current`).

---

## 3. Alternative: BRIN Indexing

If writes are strictly ordered by time (mostly true), **BRIN** indexes on `created_at` are 90% smaller than B-Tree.

**Action:** Replace `idx_ingest_idempotency_expires_at` with BRIN index if index size > 10GB.

---

## 4. Emergency Shedding (The 100x Plan)

If DB CPU hits 100% due to ingest:

1.  **Enable `DEGRADED` Mode:**
    - Writes go ONLY to `ingest_fallback_buffer` (append-only log is faster than Unique Index check).
2.  **Recover Later:**
    - Workers process buffer at controlled rate.

---

-- =============================================================================
-- PR-9 Option B: If partitioning is postponed — add BRIN on created_at for
-- range/ordering queries (e.g. cleanup by expires_at, time-ordered scans).
-- Safe to run on non-partitioned ingest_idempotency or on partitioned parent
-- (index propagates to partitions). Partial indexes already cover (site_id,
-- year_month, billable) from PR-1/PR-2.
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_ingest_idempotency_created_at_brin
    ON public.ingest_idempotency USING BRIN (created_at) WITH (pages_per_range = 32);

COMMENT ON INDEX public.idx_ingest_idempotency_created_at_brin IS
    'PR-9 Option B: BRIN for time-ordered scans and partition-like pruning when table is not partitioned.';

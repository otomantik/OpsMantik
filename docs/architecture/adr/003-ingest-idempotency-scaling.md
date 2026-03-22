# ADR 003: ingest_idempotency — scaling approach (draft)

- **Status:** Proposed
- **Date:** 2026-03-22
- **Context:** [`TIER1_BACKEND_AUDIT_2026.md`](../AUDIT/TIER1_BACKEND_AUDIT_2026.md) and [SCALING_INGEST_IDEMPOTENCY.md](../OPS/SCALING_INGEST_IDEMPOTENCY.md) note table growth and index pressure at high ingest volume.
- **Decision (draft):**
  1. **Measure first:** On staging (or read replica), record row count, index size, and hot queries touching `ingest_idempotency`.
  2. **Retention:** Confirm idempotency cleanup cron / retention policy matches [`ingest_idempotency` retention migrations](../../architecture/OPS/SCALING_INGEST_IDEMPOTENCY.md); no silent bloat.
  3. **Partitioning (if needed):** Prefer **monthly** or **site_id hash** partitions aligned with existing `year_month` / `site_id` access patterns; any migration must be **online** with maintenance window plan.
- **Consequences:** Partitioning is a **major** migration — requires staging replay, rollback plan, and DBA review.
- **Links:** [INGEST_IDEMPOTENCY_SCALE_BACKLOG.md](../INGEST_IDEMPOTENCY_SCALE_BACKLOG.md)

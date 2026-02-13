-- =============================================================================
-- Revenue Kernel PR-2: Idempotency versioning (additive)
-- Version encoded in key prefix (v2:<hash>); UNIQUE(site_id, idempotency_key) unchanged.
-- =============================================================================

BEGIN;

ALTER TABLE public.ingest_idempotency
  ADD COLUMN IF NOT EXISTS idempotency_version SMALLINT NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.ingest_idempotency.idempotency_version IS
  'Revenue Kernel PR-2: 1 = v1 (5s bucket); 2 = v2 (event-specific: heartbeat 10s, page_view 2s, click/call_intent 0s). Key stored as-is; version derived from key prefix or default 1.';

-- Index for reconciliation/count by (site_id, year_month, idempotency_version) for billable rows.
CREATE INDEX IF NOT EXISTS idx_ingest_idempotency_site_year_month_version_billable
  ON public.ingest_idempotency(site_id, year_month, idempotency_version)
  WHERE billable = true;

COMMENT ON INDEX public.idx_ingest_idempotency_site_year_month_version_billable IS
  'Revenue Kernel PR-2: reconciliation count by site/month/version for billable rows.';

COMMIT;

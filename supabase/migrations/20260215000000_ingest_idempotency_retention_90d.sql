-- =============================================================================
-- Revenue Kernel: ingest_idempotency retention 90 days (billing + dispute window)
-- Backfill existing rows: set expires_at = created_at + 90d where currently shorter.
-- Index idx_ingest_idempotency_expires_at already exists (20260214000000).
-- =============================================================================

UPDATE public.ingest_idempotency
SET expires_at = created_at + INTERVAL '90 days'
WHERE expires_at < created_at + INTERVAL '90 days';

COMMENT ON COLUMN public.ingest_idempotency.expires_at IS
  'Revenue Kernel: retention >= 90 days. Cleanup job may DELETE WHERE expires_at < NOW() (non-invoice-critical).';

-- =============================================================================
-- Singularity: Entropy lookup by fingerprint (IP/UA failure rate)
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.signal_entropy_by_fingerprint (
  fingerprint text PRIMARY KEY,
  failure_count bigint NOT NULL DEFAULT 0,
  total_count bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.signal_entropy_by_fingerprint IS
  'Singularity: Per-fingerprint (e.g. hash(IP+UA)) failure rate. High score -> uncertainty_bit for analytics.';

CREATE INDEX IF NOT EXISTS idx_signal_entropy_updated
  ON public.signal_entropy_by_fingerprint (updated_at DESC);

ALTER TABLE public.signal_entropy_by_fingerprint ENABLE ROW LEVEL SECURITY;
CREATE POLICY "signal_entropy_service_role"
  ON public.signal_entropy_by_fingerprint FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role');
GRANT ALL ON public.signal_entropy_by_fingerprint TO service_role;

COMMIT;

-- =============================================================================
-- PR10: Append-only attempt ledger for provider uploads.
-- service_role only (RLS enabled, no policies). Multi-tenant by site_id.
-- No secrets stored.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.provider_upload_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  provider_key text NOT NULL,
  batch_id text NOT NULL,
  phase text NOT NULL CHECK (phase IN ('STARTED', 'FINISHED')),
  claimed_count int,
  completed_count int,
  failed_count int,
  retry_count int,
  duration_ms int,
  provider_request_id text,
  error_code text,
  error_category text
);

COMMENT ON TABLE public.provider_upload_attempts IS
  'PR10: Append-only ledger of provider upload attempts. One STARTED + one FINISHED per attempt (same batch_id). service_role only.';

CREATE INDEX IF NOT EXISTS idx_provider_upload_attempts_site_provider_created
  ON public.provider_upload_attempts (site_id, provider_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_provider_upload_attempts_batch_id
  ON public.provider_upload_attempts (batch_id);

ALTER TABLE public.provider_upload_attempts ENABLE ROW LEVEL SECURITY;

-- No policies: only service_role (worker/cron) can read/write. Authenticated/anon get no access.

GRANT SELECT, INSERT ON public.provider_upload_attempts TO service_role;

COMMIT;

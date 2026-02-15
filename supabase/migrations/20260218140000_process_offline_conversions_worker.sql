-- =============================================================================
-- PR-G4: Worker loop — claim jobs for processing (QUEUED/RETRY, next_retry_at).
-- Adds v2 columns and index if not present (idempotent with G2); creates claim RPC.
-- =============================================================================

BEGIN;

-- Ensure v2 columns exist (idempotent; no-op if G2 already applied)
ALTER TABLE public.offline_conversion_queue
  ADD COLUMN IF NOT EXISTS provider_key text NOT NULL DEFAULT 'google_ads',
  ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS retry_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS provider_ref text;

-- Allow RETRY in status
ALTER TABLE public.offline_conversion_queue DROP CONSTRAINT IF EXISTS offline_conversion_queue_status_check;
ALTER TABLE public.offline_conversion_queue
  ADD CONSTRAINT offline_conversion_queue_status_check
  CHECK (status IN ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'RETRY'));

CREATE INDEX IF NOT EXISTS idx_offline_conversion_queue_provider_status_retry
  ON public.offline_conversion_queue (provider_key, status, next_retry_at)
  WHERE status IN ('QUEUED', 'RETRY');

-- -----------------------------------------------------------------------------
-- claim_offline_conversion_jobs_v2: claim QUEUED/RETRY with next_retry_at <= now()
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_offline_conversion_jobs_v2(
  p_limit int DEFAULT 50,
  p_provider_key text DEFAULT NULL
)
RETURNS SETOF public.offline_conversion_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit int;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'claim_offline_conversion_jobs_v2 may only be called by service_role', ERRCODE = 'P0001';
  END IF;

  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 50), 500));

  RETURN QUERY
  UPDATE public.offline_conversion_queue q
  SET status = 'PROCESSING', updated_at = now()
  FROM (
    SELECT oq.id
    FROM public.offline_conversion_queue oq
    WHERE oq.status IN ('QUEUED', 'RETRY')
      AND oq.next_retry_at <= now()
      AND (p_provider_key IS NULL OR oq.provider_key = p_provider_key)
    ORDER BY oq.next_retry_at ASC
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  ) sub
  WHERE q.id = sub.id
  RETURNING q.*;
END;
$$;

COMMENT ON FUNCTION public.claim_offline_conversion_jobs_v2(int, text) IS
  'PR-G4: Claim jobs for worker. status IN (QUEUED,RETRY), next_retry_at <= now(). Optional provider_key filter. Service_role only.';

GRANT EXECUTE ON FUNCTION public.claim_offline_conversion_jobs_v2(int, text) TO service_role;

COMMIT;

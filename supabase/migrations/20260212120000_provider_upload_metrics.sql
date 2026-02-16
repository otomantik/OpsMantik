-- Site-scoped provider upload counters. Service_role only (no RLS policy for authenticated).
-- Worker increments per (site_id, provider_key) after each group.

BEGIN;

CREATE TABLE IF NOT EXISTS public.provider_upload_metrics (
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  provider_key text NOT NULL,
  attempts_total bigint NOT NULL DEFAULT 0,
  completed_total bigint NOT NULL DEFAULT 0,
  failed_total bigint NOT NULL DEFAULT 0,
  retry_total bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, provider_key)
);

COMMENT ON TABLE public.provider_upload_metrics IS
  'Site-scoped upload counters for provider worker. Written by service_role only.';

CREATE INDEX IF NOT EXISTS idx_provider_upload_metrics_updated_at
  ON public.provider_upload_metrics (updated_at DESC);

ALTER TABLE public.provider_upload_metrics ENABLE ROW LEVEL SECURITY;

-- No policy for authenticated; service_role bypasses RLS. Only cron/worker writes.

CREATE OR REPLACE FUNCTION public.increment_provider_upload_metrics(
  p_site_id uuid,
  p_provider_key text,
  p_attempts_delta bigint DEFAULT 0,
  p_completed_delta bigint DEFAULT 0,
  p_failed_delta bigint DEFAULT 0,
  p_retry_delta bigint DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Enterprise hardening: allow only service_role (explicit role check).
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'increment_provider_upload_metrics may only be called by service_role', ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.provider_upload_metrics (site_id, provider_key, attempts_total, completed_total, failed_total, retry_total, updated_at)
  VALUES (p_site_id, p_provider_key, GREATEST(0, p_attempts_delta), GREATEST(0, p_completed_delta), GREATEST(0, p_failed_delta), GREATEST(0, p_retry_delta), now())
  ON CONFLICT (site_id, provider_key) DO UPDATE SET
    attempts_total = public.provider_upload_metrics.attempts_total + GREATEST(0, p_attempts_delta),
    completed_total = public.provider_upload_metrics.completed_total + GREATEST(0, p_completed_delta),
    failed_total = public.provider_upload_metrics.failed_total + GREATEST(0, p_failed_delta),
    retry_total = public.provider_upload_metrics.retry_total + GREATEST(0, p_retry_delta),
    updated_at = now();
END;
$$;

COMMENT ON FUNCTION public.increment_provider_upload_metrics(uuid, text, bigint, bigint, bigint, bigint) IS
  'Increment site-scoped provider upload counters. Service_role only.';

GRANT EXECUTE ON FUNCTION public.increment_provider_upload_metrics(uuid, text, bigint, bigint, bigint, bigint) TO service_role;

COMMIT;

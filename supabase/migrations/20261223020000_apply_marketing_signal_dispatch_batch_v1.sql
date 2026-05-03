BEGIN;

-- Sweeps and recovery compare against `updated_at`; `20260502120000_ensure_oci_queue_and_signals.sql` did not add it.
ALTER TABLE IF EXISTS public.marketing_signals
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public.apply_marketing_signal_dispatch_batch_v1(
  p_site_id uuid,
  p_signal_ids uuid[],
  p_expect_status text,
  p_new_status text,
  p_google_sent_at timestamptz DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role required' USING ERRCODE = 'P0001';
  END IF;

  IF p_signal_ids IS NULL OR COALESCE(array_length(p_signal_ids, 1), 0) = 0 THEN
    RETURN 0;
  END IF;

  WITH upd AS (
    UPDATE public.marketing_signals ms
    SET
      dispatch_status = p_new_status,
      google_sent_at = CASE
        WHEN p_google_sent_at IS NOT NULL THEN p_google_sent_at
        ELSE ms.google_sent_at
      END,
      updated_at = now()
    WHERE ms.site_id = p_site_id
      AND ms.id = ANY (p_signal_ids)
      AND ms.dispatch_status = p_expect_status
    RETURNING ms.id
  )
  SELECT count(*)::integer INTO v_count FROM upd;

  RETURN COALESCE(v_count, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.rescue_marketing_signals_stale_processing_v1(p_cutoff timestamptz)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role required' USING ERRCODE = 'P0001';
  END IF;

  IF p_cutoff IS NULL THEN
    RETURN 0;
  END IF;

  WITH upd AS (
    UPDATE public.marketing_signals ms
    SET
      dispatch_status = 'PENDING',
      updated_at = now()
    WHERE ms.dispatch_status = 'PROCESSING'
      AND ms.updated_at < p_cutoff
    RETURNING ms.id
  )
  SELECT count(*)::integer INTO v_count FROM upd;

  RETURN COALESCE(v_count, 0);
END;
$$;

-- Advisor 0028/0029: SECURITY DEFINER RPCs must not be EXECUTE-able by anon/authenticated (adminClient = service_role only).
REVOKE ALL ON FUNCTION public.apply_marketing_signal_dispatch_batch_v1(uuid, uuid[], text, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_marketing_signal_dispatch_batch_v1(uuid, uuid[], text, text, timestamptz) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_marketing_signal_dispatch_batch_v1(uuid, uuid[], text, text, timestamptz) TO service_role;

REVOKE ALL ON FUNCTION public.rescue_marketing_signals_stale_processing_v1(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rescue_marketing_signals_stale_processing_v1(timestamptz) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rescue_marketing_signals_stale_processing_v1(timestamptz) TO service_role;

COMMIT;

BEGIN;

-- Panoptic Phase 2: single DB writer path for marketing_signals.dispatch_status transitions
-- (site-scoped batch + global stale rescue). FSM enforcement remains on marketing_signals trigger.

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
  v_updated integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'apply_marketing_signal_dispatch_batch_v1 may only be called by service_role' USING ERRCODE = 'P0001';
  END IF;

  IF p_site_id IS NULL THEN
    RAISE EXCEPTION 'apply_marketing_signal_dispatch_batch_v1: p_site_id required' USING ERRCODE = '22023';
  END IF;

  IF p_signal_ids IS NULL OR cardinality(p_signal_ids) = 0 THEN
    RETURN 0;
  END IF;

  UPDATE public.marketing_signals ms
  SET
    dispatch_status = p_new_status,
    google_sent_at = COALESCE(p_google_sent_at, ms.google_sent_at),
    updated_at = now()
  WHERE ms.site_id = p_site_id
    AND ms.id = ANY (p_signal_ids)
    AND ms.dispatch_status = p_expect_status;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

COMMENT ON FUNCTION public.apply_marketing_signal_dispatch_batch_v1(uuid, uuid[], text, text, timestamptz) IS
  'Canonical marketing_signals dispatch_status transition (expect-status optimistic lock, site-scoped).';

CREATE OR REPLACE FUNCTION public.rescue_marketing_signals_stale_processing_v1(
  p_cutoff timestamptz
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'rescue_marketing_signals_stale_processing_v1 may only be called by service_role' USING ERRCODE = 'P0001';
  END IF;

  IF p_cutoff IS NULL THEN
    RAISE EXCEPTION 'rescue_marketing_signals_stale_processing_v1: p_cutoff required' USING ERRCODE = '22023';
  END IF;

  UPDATE public.marketing_signals ms
  SET
    dispatch_status = 'PENDING',
    updated_at = now()
  WHERE ms.dispatch_status = 'PROCESSING'
    AND ms.updated_at < p_cutoff;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

COMMENT ON FUNCTION public.rescue_marketing_signals_stale_processing_v1(timestamptz) IS
  'Maintenance: PROCESSING -> PENDING for rows stuck past p_cutoff (matches oci-maintenance sweep).';

REVOKE ALL ON FUNCTION public.apply_marketing_signal_dispatch_batch_v1(uuid, uuid[], text, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_marketing_signal_dispatch_batch_v1(uuid, uuid[], text, text, timestamptz) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_marketing_signal_dispatch_batch_v1(uuid, uuid[], text, text, timestamptz) TO service_role;

REVOKE ALL ON FUNCTION public.rescue_marketing_signals_stale_processing_v1(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rescue_marketing_signals_stale_processing_v1(timestamptz) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rescue_marketing_signals_stale_processing_v1(timestamptz) TO service_role;

COMMIT;

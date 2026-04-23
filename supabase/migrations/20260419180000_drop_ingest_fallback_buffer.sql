BEGIN;

DROP TABLE IF EXISTS public.ingest_fallback_buffer CASCADE;
DROP FUNCTION IF EXISTS public.recover_stuck_ingest_fallback(int);
DROP FUNCTION IF EXISTS public.get_and_claim_fallback_batch(int);
DROP FUNCTION IF EXISTS public.update_fallback_on_publish_failure(jsonb);

CREATE OR REPLACE FUNCTION public.erase_pii_for_identifier(
  p_site_id uuid,
  p_identifier text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sessions integer := 0;
  v_calls integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role required' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.sessions
  SET
    gclid = NULL,
    wbraid = NULL,
    gbraid = NULL,
    fingerprint = NULL
  WHERE site_id = p_site_id
    AND (
      coalesce(gclid, '') = p_identifier
      OR coalesce(wbraid, '') = p_identifier
      OR coalesce(gbraid, '') = p_identifier
      OR coalesce(fingerprint, '') = p_identifier
    );
  GET DIAGNOSTICS v_sessions = ROW_COUNT;

  UPDATE public.calls
  SET
    click_id = NULL,
    gclid = NULL,
    wbraid = NULL,
    gbraid = NULL
  WHERE site_id = p_site_id
    AND (
      coalesce(click_id, '') = p_identifier
      OR coalesce(gclid, '') = p_identifier
      OR coalesce(wbraid, '') = p_identifier
      OR coalesce(gbraid, '') = p_identifier
    );
  GET DIAGNOSTICS v_calls = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'sessions_updated', v_sessions,
    'calls_updated', v_calls
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reset_business_data_before_cutoff_v1(
  p_cutoff timestamptz,
  p_site_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_events integer := 0;
  v_calls integer := 0;
  v_sessions integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role required' USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM public.events e
  WHERE e.created_at < p_cutoff
    AND (p_site_id IS NULL OR e.site_id = p_site_id);
  GET DIAGNOSTICS v_events = ROW_COUNT;

  DELETE FROM public.calls c
  WHERE c.created_at < p_cutoff
    AND (p_site_id IS NULL OR c.site_id = p_site_id);
  GET DIAGNOSTICS v_calls = ROW_COUNT;

  DELETE FROM public.sessions s
  WHERE s.created_at < p_cutoff
    AND (p_site_id IS NULL OR s.site_id = p_site_id);
  GET DIAGNOSTICS v_sessions = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'events_deleted', v_events,
    'calls_deleted', v_calls,
    'sessions_deleted', v_sessions
  );
END;
$$;

COMMIT;

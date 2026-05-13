-- Close stale UPLOADED queue rows via ledger (append_worker_transition_batch_v2) instead of
-- direct UPDATE on offline_conversion_queue. Preserves audit trail + FSM enforcement.
-- Replaces close_stale_uploaded_conversions body; tightens grants to service_role only.

BEGIN;

CREATE OR REPLACE FUNCTION public.close_stale_uploaded_conversions(p_min_age_hours integer DEFAULT 48)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_now timestamptz := now();
  v_cutoff timestamptz;
  v_hours integer := GREATEST(COALESCE(p_min_age_hours, 48), 1);
  v_ids uuid[];
  v_closed integer := 0;
  v_msg text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'close_stale_uploaded_conversions may only be called by service_role'
      USING ERRCODE = 'P0001';
  END IF;

  v_cutoff := v_now - (v_hours || ' hours')::interval;
  v_msg := 'Closed by zombie sweeper: UPLOADED for > ' || v_hours::text || 'h without verification';

  WITH locked AS (
    SELECT q.id
    FROM public.offline_conversion_queue q
    WHERE q.status = 'UPLOADED'
      AND q.updated_at < v_cutoff
    ORDER BY q.id
    LIMIT 10000
    FOR UPDATE SKIP LOCKED
  )
  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[])
  INTO v_ids
  FROM locked;

  IF COALESCE(array_length(v_ids, 1), 0) = 0 THEN
    RETURN 0;
  END IF;

  SELECT public.append_worker_transition_batch_v2(
    v_ids,
    'COMPLETED_UNVERIFIED',
    v_now,
    jsonb_build_object(
      'last_error', left(v_msg, 1024),
      'provider_error_category', 'DETERMINISTIC_SKIP'
    )
  )
  INTO v_closed;

  RETURN COALESCE(v_closed, 0);
END;
$$;

ALTER FUNCTION public.close_stale_uploaded_conversions(integer) OWNER TO postgres;

COMMENT ON FUNCTION public.close_stale_uploaded_conversions(integer) IS
  'Sweeper: UPLOADED rows older than p_min_age_hours -> COMPLETED_UNVERIFIED via append_worker_transition_batch_v2 (ledger). service_role only. Batch cap 10000 per call.';

REVOKE ALL ON FUNCTION public.close_stale_uploaded_conversions(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.close_stale_uploaded_conversions(integer) FROM anon;
REVOKE ALL ON FUNCTION public.close_stale_uploaded_conversions(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.close_stale_uploaded_conversions(integer) TO service_role;

COMMIT;

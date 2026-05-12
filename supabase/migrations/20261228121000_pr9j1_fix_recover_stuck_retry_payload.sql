-- PR-9J.1: make legacy stale PROCESSING recovery comply with RETRY invariants.
--
-- recover_stuck_offline_conversion_jobs previously appended RETRY transitions
-- without next_retry_at/provider_error_category, which violates the
-- oci_queue_retry_future snapshot constraint and leaves recovery cron runs in
-- PARTIAL/zero-effect mode.

BEGIN;

CREATE OR REPLACE FUNCTION public.recover_stuck_offline_conversion_jobs(
  p_min_age_minutes integer DEFAULT 120
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_cutoff timestamptz := now() - (GREATEST(COALESCE(p_min_age_minutes, 120), 1) || ' minutes')::interval;
  v_next_retry_at timestamptz := now() + interval '1 second';
  v_queue_ids uuid[] := ARRAY[]::uuid[];
  v_recovered_count integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'recover_stuck_offline_conversion_jobs may only be called by service_role'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(array_agg(q.id ORDER BY q.id), ARRAY[]::uuid[])
  INTO v_queue_ids
  FROM public.offline_conversion_queue AS q
  WHERE q.status = 'PROCESSING'
    AND (
      q.claimed_at < v_cutoff
      OR (q.claimed_at IS NULL AND q.updated_at < v_cutoff)
    );

  IF COALESCE(array_length(v_queue_ids, 1), 0) = 0 THEN
    RETURN 0;
  END IF;

  SELECT public.append_worker_transition_batch_v2(
    v_queue_ids,
    'RETRY',
    now(),
    jsonb_build_object(
      'reason', 'PROCESSING_STALE_RECOVERY',
      'actor', 'recover_stuck_offline_conversion_jobs',
      'min_age_minutes', GREATEST(COALESCE(p_min_age_minutes, 120), 1),
      'last_error', 'PROCESSING_STALE_RECOVERY',
      'provider_error_category', 'TRANSIENT',
      'next_retry_at', v_next_retry_at,
      'clear_fields', jsonb_build_array(
        'claimed_at',
        'provider_request_id',
        'provider_ref'
      )
    )
  )
  INTO v_recovered_count;

  RETURN COALESCE(v_recovered_count, 0);
END;
$$;

COMMENT ON FUNCTION public.recover_stuck_offline_conversion_jobs(integer)
  IS 'Legacy compatibility recovery RPC for stale PROCESSING rows -> RETRY. PR-9J.1 sets RETRY payload invariants and clears stale claim metadata.';

REVOKE ALL ON FUNCTION public.recover_stuck_offline_conversion_jobs(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recover_stuck_offline_conversion_jobs(integer) FROM anon;
REVOKE ALL ON FUNCTION public.recover_stuck_offline_conversion_jobs(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.recover_stuck_offline_conversion_jobs(integer) TO service_role;

COMMIT;

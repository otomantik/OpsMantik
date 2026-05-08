-- PR-9G.1: fix row-scoped recovery transition dependency drift.
-- Recovery RPC must not depend on append_sweeper_transition_batch when canonical helper is append_worker_transition_batch_v2.

CREATE OR REPLACE FUNCTION public.recover_safe_processing_queue_rows_v1(
  p_queue_ids uuid[],
  p_min_age_minutes integer DEFAULT 120,
  p_recovery_reason text DEFAULT 'SAFE_TO_RETRY_CLASSIFIED',
  p_actor text DEFAULT 'processing_recovery_classifier'
)
RETURNS TABLE(
  requested_count integer,
  eligible_count integer,
  recovered_count integer,
  skipped_count integer,
  skipped_terminal_count integer,
  skipped_not_processing_count integer,
  skipped_not_stale_count integer,
  skipped_missing_id_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ids uuid[] := ARRAY[]::uuid[];
  v_cutoff timestamptz := now() - (GREATEST(COALESCE(p_min_age_minutes, 120), 1) || ' minutes')::interval;
  v_terminal_count integer := 0;
  v_not_processing_count integer := 0;
  v_not_stale_count integer := 0;
  v_eligible_count integer := 0;
  v_recovered_count integer := 0;
  v_requested_count integer := 0;
  v_missing_id_count integer := 0;
  v_reason text := left(COALESCE(NULLIF(trim(p_recovery_reason), ''), 'SAFE_TO_RETRY_CLASSIFIED'), 256);
  v_actor text := left(COALESCE(NULLIF(trim(p_actor), ''), 'processing_recovery_classifier'), 128);
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'recover_safe_processing_queue_rows_v1 may only be called by service_role'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(array_agg(queue_id ORDER BY queue_id), ARRAY[]::uuid[])
  INTO v_ids
  FROM (
    SELECT DISTINCT queue_id
    FROM unnest(COALESCE(p_queue_ids, ARRAY[]::uuid[])) AS input_ids(queue_id)
    WHERE queue_id IS NOT NULL
  ) deduped;

  v_requested_count := COALESCE(array_length(v_ids, 1), 0);
  IF v_requested_count = 0 THEN
    RETURN QUERY SELECT 0, 0, 0, 0, 0, 0, 0, 0;
    RETURN;
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE q.status IN ('COMPLETED', 'COMPLETED_UNVERIFIED', 'FAILED', 'DEAD_LETTER_QUARANTINE', 'VOIDED_BY_REVERSAL'))::int,
    COUNT(*) FILTER (WHERE q.status <> 'PROCESSING' AND q.status NOT IN ('COMPLETED', 'COMPLETED_UNVERIFIED', 'FAILED', 'DEAD_LETTER_QUARANTINE', 'VOIDED_BY_REVERSAL'))::int,
    COUNT(*) FILTER (
      WHERE q.status = 'PROCESSING'
        AND NOT (q.claimed_at < v_cutoff OR (q.claimed_at IS NULL AND q.updated_at < v_cutoff))
    )::int,
    COUNT(*) FILTER (
      WHERE q.status = 'PROCESSING'
        AND (q.claimed_at < v_cutoff OR (q.claimed_at IS NULL AND q.updated_at < v_cutoff))
    )::int
  INTO
    v_terminal_count,
    v_not_processing_count,
    v_not_stale_count,
    v_eligible_count
  FROM public.offline_conversion_queue q
  JOIN unnest(v_ids) input_ids(queue_id) ON input_ids.queue_id = q.id;

  v_missing_id_count := GREATEST(
    v_requested_count - (v_terminal_count + v_not_processing_count + v_not_stale_count + v_eligible_count),
    0
  );

  IF v_eligible_count > 0 THEN
    SELECT public.append_worker_transition_batch_v2(
      ARRAY(
        SELECT q.id
        FROM public.offline_conversion_queue q
        JOIN unnest(v_ids) input_ids(queue_id) ON input_ids.queue_id = q.id
        WHERE q.status = 'PROCESSING'
          AND (q.claimed_at < v_cutoff OR (q.claimed_at IS NULL AND q.updated_at < v_cutoff))
        ORDER BY q.id
      ),
      'RETRY',
      now(),
      jsonb_build_object(
        'source', 'ROW_SCOPED_RECOVERY_RPC',
        'from_status', 'PROCESSING',
        'to_status', 'RETRY',
        'recovery_reason', v_reason,
        'recovery_actor', v_actor,
        'last_error', format('%s|actor=%s', v_reason, v_actor)
      )
    )
    INTO v_recovered_count;
  END IF;

  RETURN QUERY
  SELECT
    v_requested_count,
    v_eligible_count,
    COALESCE(v_recovered_count, 0),
    GREATEST(v_requested_count - COALESCE(v_recovered_count, 0), 0),
    v_terminal_count,
    v_not_processing_count,
    v_not_stale_count,
    v_missing_id_count;
END;
$$;

COMMENT ON FUNCTION public.recover_safe_processing_queue_rows_v1(uuid[], integer, text, text)
  IS 'PR-4D.1 additive row-scoped PROCESSING recovery path. PR-9G.1 updates dependency to append_worker_transition_batch_v2 and preserves counter contract.';

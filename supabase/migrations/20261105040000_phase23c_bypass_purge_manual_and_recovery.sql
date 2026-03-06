BEGIN;

CREATE OR REPLACE FUNCTION public.append_manual_transition_batch(
  p_queue_ids uuid[],
  p_new_status text,
  p_created_at timestamptz DEFAULT now(),
  p_clear_errors boolean DEFAULT false,
  p_error_code text DEFAULT NULL,
  p_error_category text DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_queue_ids uuid[] := ARRAY[]::uuid[];
  v_inserted integer := 0;
  v_clear_fields text[] := ARRAY[]::text[];
  v_payload jsonb := '{}'::jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'append_manual_transition_batch may only be called by service_role', ERRCODE = 'P0001';
  END IF;

  IF p_new_status NOT IN ('QUEUED', 'FAILED') THEN
    RAISE EXCEPTION 'invalid_status: %', p_new_status;
  END IF;

  SELECT COALESCE(array_agg(queue_id ORDER BY queue_id), ARRAY[]::uuid[])
  INTO v_queue_ids
  FROM (
    SELECT DISTINCT queue_id
    FROM unnest(COALESCE(p_queue_ids, ARRAY[]::uuid[])) AS input_ids(queue_id)
    WHERE queue_id IS NOT NULL
  ) AS deduped;

  IF COALESCE(array_length(v_queue_ids, 1), 0) = 0 THEN
    RETURN 0;
  END IF;

  v_clear_fields := ARRAY['claimed_at', 'next_retry_at'];
  IF p_clear_errors THEN
    v_clear_fields := v_clear_fields || ARRAY['last_error', 'provider_error_code', 'provider_error_category'];
  END IF;

  IF p_new_status = 'FAILED' THEN
    v_payload := jsonb_strip_nulls(
      jsonb_build_object(
        'last_error', left(COALESCE(p_reason, 'MANUALLY_MARKED_FAILED'), 1024),
        'provider_error_code', left(COALESCE(p_error_code, 'MANUAL_FAIL'), 64),
        'provider_error_category', COALESCE(p_error_category, 'PERMANENT')
      )
    );
  ELSE
    v_payload := '{}'::jsonb;
  END IF;

  IF array_length(v_clear_fields, 1) IS NOT NULL AND array_length(v_clear_fields, 1) > 0 THEN
    v_payload := v_payload || jsonb_build_object('clear_fields', to_jsonb(v_clear_fields));
  END IF;

  PERFORM set_config('opsmantik.skip_snapshot_trigger', 'on', true);

  INSERT INTO public.oci_queue_transitions (
    queue_id,
    new_status,
    actor,
    created_at,
    error_payload,
    brain_score,
    match_score,
    queue_priority,
    score_version,
    score_flags,
    score_explain_jsonb
  )
  SELECT
    q.id,
    p_new_status,
    'MANUAL',
    p_created_at,
    NULLIF(v_payload, '{}'::jsonb),
    q.brain_score,
    q.match_score,
    q.queue_priority,
    q.score_version,
    q.score_flags,
    q.score_explain_jsonb
  FROM public.offline_conversion_queue AS q
  JOIN unnest(v_queue_ids) AS input_ids(queue_id)
    ON input_ids.queue_id = q.id
  ORDER BY q.id;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  PERFORM public.apply_snapshot_batch(v_queue_ids);
  PERFORM public.assert_latest_ledger_matches_snapshot(v_queue_ids);

  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION public.append_manual_transition_batch(uuid[], text, timestamptz, boolean, text, text, text) IS
  'Phase 23C manual queue mutation path. Actor is hardcoded to MANUAL and snapshot apply happens in the same transaction.';

GRANT EXECUTE ON FUNCTION public.append_manual_transition_batch(uuid[], text, timestamptz, boolean, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.append_sweeper_transition_batch(
  p_queue_ids uuid[],
  p_new_status text,
  p_created_at timestamptz DEFAULT now(),
  p_last_error text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_queue_ids uuid[] := ARRAY[]::uuid[];
  v_inserted integer := 0;
  v_payload jsonb := '{}'::jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'append_sweeper_transition_batch may only be called by service_role', ERRCODE = 'P0001';
  END IF;

  IF p_new_status NOT IN ('RETRY', 'FAILED', 'QUEUED', 'COMPLETED_UNVERIFIED') THEN
    RAISE EXCEPTION 'invalid_status: %', p_new_status;
  END IF;

  SELECT COALESCE(array_agg(queue_id ORDER BY queue_id), ARRAY[]::uuid[])
  INTO v_queue_ids
  FROM (
    SELECT DISTINCT queue_id
    FROM unnest(COALESCE(p_queue_ids, ARRAY[]::uuid[])) AS input_ids(queue_id)
    WHERE queue_id IS NOT NULL
  ) AS deduped;

  IF COALESCE(array_length(v_queue_ids, 1), 0) = 0 THEN
    RETURN 0;
  END IF;

  IF p_new_status = 'RETRY' THEN
    v_payload := jsonb_build_object('next_retry_at', NULL, 'clear_fields', to_jsonb(ARRAY['next_retry_at']::text[]));
  ELSIF p_new_status = 'FAILED' AND p_last_error IS NOT NULL THEN
    v_payload := jsonb_build_object('last_error', left(p_last_error, 1024));
  END IF;

  PERFORM set_config('opsmantik.skip_snapshot_trigger', 'on', true);

  INSERT INTO public.oci_queue_transitions (
    queue_id,
    new_status,
    actor,
    created_at,
    error_payload,
    brain_score,
    match_score,
    queue_priority,
    score_version,
    score_flags,
    score_explain_jsonb
  )
  SELECT
    q.id,
    p_new_status,
    'SWEEPER',
    p_created_at,
    NULLIF(v_payload, '{}'::jsonb),
    q.brain_score,
    q.match_score,
    q.queue_priority,
    q.score_version,
    q.score_flags,
    q.score_explain_jsonb
  FROM public.offline_conversion_queue AS q
  JOIN unnest(v_queue_ids) AS input_ids(queue_id)
    ON input_ids.queue_id = q.id
  ORDER BY q.id;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  PERFORM public.apply_snapshot_batch(v_queue_ids);
  PERFORM public.assert_latest_ledger_matches_snapshot(v_queue_ids);

  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION public.append_sweeper_transition_batch(uuid[], text, timestamptz, text) IS
  'Phase 23C sweeper-owned batch append/apply path for zombie recovery and cleanup transitions.';

GRANT EXECUTE ON FUNCTION public.append_sweeper_transition_batch(uuid[], text, timestamptz, text) TO service_role;

CREATE OR REPLACE FUNCTION public.update_queue_status_locked(
  p_ids uuid[],
  p_site_id uuid,
  p_action text,
  p_clear_errors boolean DEFAULT false,
  p_error_code text DEFAULT 'MANUAL_FAIL',
  p_error_category text DEFAULT 'PERMANENT',
  p_reason text DEFAULT 'MANUALLY_MARKED_FAILED'
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_affected int := 0;
  v_now timestamptz := now();
  v_queue_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'update_queue_status_locked may only be called by service_role', ERRCODE = 'P0001';
  END IF;

  IF array_length(p_ids, 1) IS NULL OR array_length(p_ids, 1) = 0 THEN
    RETURN 0;
  END IF;

  CASE p_action
    WHEN 'RETRY_SELECTED' THEN
      SELECT COALESCE(array_agg(q.id ORDER BY q.id), ARRAY[]::uuid[])
      INTO v_queue_ids
      FROM public.offline_conversion_queue AS q
      WHERE q.id = ANY(p_ids)
        AND q.site_id = p_site_id
        AND q.status IN ('FAILED', 'RETRY');

      v_affected := public.append_manual_transition_batch(v_queue_ids, 'QUEUED', v_now, false, NULL, NULL, NULL);

    WHEN 'RESET_TO_QUEUED' THEN
      SELECT COALESCE(array_agg(q.id ORDER BY q.id), ARRAY[]::uuid[])
      INTO v_queue_ids
      FROM public.offline_conversion_queue AS q
      WHERE q.id = ANY(p_ids)
        AND q.site_id = p_site_id
        AND q.status IN ('QUEUED', 'RETRY', 'PROCESSING', 'FAILED');

      v_affected := public.append_manual_transition_batch(
        v_queue_ids,
        'QUEUED',
        v_now,
        COALESCE(p_clear_errors, false),
        NULL,
        NULL,
        NULL
      );

    WHEN 'MARK_FAILED' THEN
      SELECT COALESCE(array_agg(q.id ORDER BY q.id), ARRAY[]::uuid[])
      INTO v_queue_ids
      FROM public.offline_conversion_queue AS q
      WHERE q.id = ANY(p_ids)
        AND q.site_id = p_site_id
        AND q.status IN ('PROCESSING', 'QUEUED', 'RETRY');

      v_affected := public.append_manual_transition_batch(
        v_queue_ids,
        'FAILED',
        v_now,
        false,
        p_error_code,
        p_error_category,
        p_reason
      );

    ELSE
      RAISE EXCEPTION USING MESSAGE = 'invalid_action', DETAIL = 'action must be RETRY_SELECTED, RESET_TO_QUEUED, or MARK_FAILED', ERRCODE = 'P0001';
  END CASE;

  RETURN v_affected;
END;
$$;

COMMENT ON FUNCTION public.update_queue_status_locked(uuid[], uuid, text, boolean, text, text, text) IS
  'Phase 23C compat wrapper for OCI control actions. Delegates to append_manual_transition_batch.';

GRANT EXECUTE ON FUNCTION public.update_queue_status_locked(uuid[], uuid, text, boolean, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.recover_stuck_offline_conversion_jobs(p_min_age_minutes int DEFAULT 120)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_failed_ids uuid[] := ARRAY[]::uuid[];
  v_retry_ids uuid[] := ARRAY[]::uuid[];
  v_cutoff timestamptz := now() - (p_min_age_minutes || ' minutes')::interval;
  v_failed int := 0;
  v_retry int := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'recover_stuck_offline_conversion_jobs may only be called by service_role' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(array_agg(q.id ORDER BY q.id), ARRAY[]::uuid[])
  INTO v_failed_ids
  FROM public.offline_conversion_queue AS q
  WHERE q.status = 'PROCESSING'
    AND (q.retry_count >= 7 OR q.attempt_count >= 7)
    AND (q.claimed_at < v_cutoff OR (q.claimed_at IS NULL AND q.updated_at < v_cutoff));

  SELECT COALESCE(array_agg(q.id ORDER BY q.id), ARRAY[]::uuid[])
  INTO v_retry_ids
  FROM public.offline_conversion_queue AS q
  WHERE q.status = 'PROCESSING'
    AND q.retry_count < 7
    AND q.attempt_count < 7
    AND (q.claimed_at < v_cutoff OR (q.claimed_at IS NULL AND q.updated_at < v_cutoff));

  v_failed := public.append_sweeper_transition_batch(
    v_failed_ids,
    'FAILED',
    now(),
    'Zombie recovered: max retries exhausted'
  );

  v_retry := public.append_sweeper_transition_batch(
    v_retry_ids,
    'RETRY',
    now(),
    NULL
  );

  RETURN v_retry + v_failed;
END;
$$;

COMMENT ON FUNCTION public.recover_stuck_offline_conversion_jobs(int) IS
  'Phase 23C sweeper-owned zombie recovery path. Delegates to append_sweeper_transition_batch for FAILED or RETRY recovery.';

GRANT EXECUTE ON FUNCTION public.recover_stuck_offline_conversion_jobs(int) TO service_role;

COMMIT;

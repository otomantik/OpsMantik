BEGIN;

CREATE OR REPLACE FUNCTION public.append_script_claim_transition_batch(
  p_queue_ids uuid[],
  p_claimed_at timestamptz DEFAULT now()
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_queue_ids uuid[] := ARRAY[]::uuid[];
  v_inserted integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'append_script_claim_transition_batch may only be called by service_role', ERRCODE = 'P0001';
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
    'PROCESSING',
    'SCRIPT',
    p_claimed_at,
    jsonb_build_object(
      'claimed_at', p_claimed_at,
      'attempt_count', q.attempt_count + 1
    ),
    q.brain_score,
    q.match_score,
    q.queue_priority,
    q.score_version,
    q.score_flags,
    q.score_explain_jsonb
  FROM public.offline_conversion_queue AS q
  JOIN unnest(v_queue_ids) AS input_ids(queue_id)
    ON input_ids.queue_id = q.id
  WHERE q.status IN ('QUEUED', 'RETRY')
  ORDER BY q.id;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  PERFORM public.apply_snapshot_batch(v_queue_ids);
  PERFORM public.assert_latest_ledger_matches_snapshot(v_queue_ids);

  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION public.append_script_claim_transition_batch(uuid[], timestamptz) IS
  'Phase 23C script export claim path. Actor is hardcoded to SCRIPT, attempt_count increments in the ledger payload, and snapshot apply happens in the same transaction.';

GRANT EXECUTE ON FUNCTION public.append_script_claim_transition_batch(uuid[], timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.append_worker_transition_batch(
  p_queue_ids uuid[],
  p_new_status text,
  p_created_at timestamptz DEFAULT now(),
  p_last_error text DEFAULT NULL,
  p_error_code text DEFAULT NULL,
  p_error_category text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_queue_ids uuid[] := ARRAY[]::uuid[];
  v_inserted integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'append_worker_transition_batch may only be called by service_role', ERRCODE = 'P0001';
  END IF;

  IF p_new_status NOT IN ('RETRY', 'FAILED', 'DEAD_LETTER_QUARANTINE', 'COMPLETED', 'COMPLETED_UNVERIFIED', 'PROCESSING', 'QUEUED', 'UPLOADED') THEN
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
    'WORKER',
    p_created_at,
    NULLIF(
      jsonb_strip_nulls(
        jsonb_build_object(
          'last_error', p_last_error,
          'provider_error_code', p_error_code,
          'provider_error_category', p_error_category
        )
      ),
      '{}'::jsonb
    ),
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

COMMENT ON FUNCTION public.append_worker_transition_batch(uuid[], text, timestamptz, text, text, text) IS
  'Phase 23C generic worker-owned batch append/apply path for terminal or retry transitions with actor hardcoded to WORKER.';

GRANT EXECUTE ON FUNCTION public.append_worker_transition_batch(uuid[], text, timestamptz, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_offline_conversion_rows_for_script_export(
  p_ids uuid[],
  p_site_id uuid
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_queue_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'claim_offline_conversion_rows_for_script_export may only be called by service_role', ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(array_agg(q.id ORDER BY q.id), ARRAY[]::uuid[])
  INTO v_queue_ids
  FROM public.offline_conversion_queue AS q
  WHERE q.id = ANY(COALESCE(p_ids, ARRAY[]::uuid[]))
    AND q.site_id = p_site_id
    AND q.status IN ('QUEUED', 'RETRY');

  RETURN public.append_script_claim_transition_batch(v_queue_ids, now());
END;
$$;

COMMENT ON FUNCTION public.claim_offline_conversion_rows_for_script_export(uuid[], uuid) IS
  'Phase 23C compat wrapper for script export claim. Delegates to append_script_claim_transition_batch.';

GRANT EXECUTE ON FUNCTION public.claim_offline_conversion_rows_for_script_export(uuid[], uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.oci_attempt_cap(
  p_max_attempts int DEFAULT 5,
  p_min_age_minutes int DEFAULT 0
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_queue_ids uuid[] := ARRAY[]::uuid[];
  v_cutoff timestamptz;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'oci_attempt_cap may only be called by service_role', ERRCODE = 'P0001';
  END IF;

  v_cutoff := now() - (p_min_age_minutes || ' minutes')::interval;

  SELECT COALESCE(array_agg(q.id ORDER BY q.id), ARRAY[]::uuid[])
  INTO v_queue_ids
  FROM public.offline_conversion_queue AS q
  WHERE q.status IN ('QUEUED', 'RETRY', 'PROCESSING')
    AND q.attempt_count >= p_max_attempts
    AND (p_min_age_minutes = 0 OR q.updated_at < v_cutoff);

  RETURN public.append_worker_transition_batch(
    v_queue_ids,
    'FAILED',
    now(),
    'MAX_ATTEMPTS_EXCEEDED',
    'MAX_ATTEMPTS',
    'PERMANENT'
  );
END;
$$;

COMMENT ON FUNCTION public.oci_attempt_cap(int, int) IS
  'Phase 23C worker-owned attempt cap path. Delegates to append_worker_transition_batch with FAILED/MAX_ATTEMPTS semantics.';

GRANT EXECUTE ON FUNCTION public.oci_attempt_cap(int, int) TO service_role;

COMMIT;

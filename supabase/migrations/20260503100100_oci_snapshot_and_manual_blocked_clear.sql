-- Extend apply_snapshot_batch clear_fields for block_reason/blocked_at.
-- Extend manual queue reset to clear block columns and allow RESET from BLOCKED_PRECEDING_SIGNALS.

BEGIN;

CREATE OR REPLACE FUNCTION public.apply_snapshot_batch(p_queue_ids uuid[]) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_queue_ids uuid[] := ARRAY[]::uuid[];
  v_invalid_transition_id uuid;
  v_invalid_queue_id uuid;
  v_invalid_clear_field text;
  v_noop_transition_id uuid;
  v_noop_queue_id uuid;
  v_updated integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'apply_snapshot_batch may only be called by service_role', ERRCODE = 'P0001';
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

  PERFORM 1
  FROM public.offline_conversion_queue AS q
  WHERE q.id = ANY(v_queue_ids)
  ORDER BY q.id
  FOR UPDATE;

  WITH latest AS (
    SELECT DISTINCT ON (t.queue_id)
      t.id,
      t.queue_id,
      t.new_status,
      t.error_payload,
      t.actor,
      t.created_at,
      t.brain_score,
      t.match_score,
      t.queue_priority,
      t.score_version,
      t.score_flags,
      t.score_explain_jsonb
    FROM public.oci_queue_transitions AS t
    WHERE t.queue_id = ANY(v_queue_ids)
    ORDER BY t.queue_id, t.created_at DESC, t.id DESC
  )
  SELECT l.id, l.queue_id
  INTO v_invalid_transition_id, v_invalid_queue_id
  FROM latest AS l
  WHERE l.error_payload IS NOT NULL
    AND jsonb_typeof(l.error_payload) <> 'object'
  LIMIT 1;

  IF v_invalid_transition_id IS NOT NULL THEN
    RAISE EXCEPTION 'oci_queue_transitions.error_payload must be a JSON object or null for transition % queue %', v_invalid_transition_id, v_invalid_queue_id;
  END IF;

  WITH latest AS (
    SELECT DISTINCT ON (t.queue_id)
      t.id,
      t.queue_id,
      t.error_payload
    FROM public.oci_queue_transitions AS t
    WHERE t.queue_id = ANY(v_queue_ids)
    ORDER BY t.queue_id, t.created_at DESC, t.id DESC
  )
  SELECT l.id, l.queue_id
  INTO v_invalid_transition_id, v_invalid_queue_id
  FROM latest AS l
  WHERE l.error_payload ? 'clear_fields'
    AND jsonb_typeof(l.error_payload->'clear_fields') <> 'array'
  LIMIT 1;

  IF v_invalid_transition_id IS NOT NULL
     AND v_invalid_queue_id IS NOT NULL THEN
    RAISE EXCEPTION 'oci_queue_transitions.error_payload.clear_fields must be an array for transition % queue %', v_invalid_transition_id, v_invalid_queue_id;
  END IF;

  WITH latest AS (
    SELECT DISTINCT ON (t.queue_id)
      t.id,
      t.queue_id,
      public.queue_transition_clear_fields(t.error_payload) AS clear_fields
    FROM public.oci_queue_transitions AS t
    WHERE t.queue_id = ANY(v_queue_ids)
    ORDER BY t.queue_id, t.created_at DESC, t.id DESC
  )
  SELECT l.id, l.queue_id, field_name
  INTO v_invalid_transition_id, v_invalid_queue_id, v_invalid_clear_field
  FROM latest AS l
  CROSS JOIN LATERAL unnest(l.clear_fields) AS field_name
  WHERE field_name NOT IN (
    'last_error',
    'provider_error_code',
    'provider_error_category',
    'next_retry_at',
    'uploaded_at',
    'claimed_at',
    'provider_request_id',
    'provider_ref',
    'block_reason',
    'blocked_at'
  )
  LIMIT 1;

  IF v_invalid_transition_id IS NOT NULL THEN
    RAISE EXCEPTION 'Unsupported clear_fields value in oci_queue_transitions.error_payload for transition % queue %: %',
      v_invalid_transition_id, v_invalid_queue_id, v_invalid_clear_field;
  END IF;

  PERFORM public.log_oci_payload_validation_event(
    latest.actor,
    latest.queue_id,
    q.site_id,
    latest.new_status,
    latest.error_payload,
    public.oci_transition_payload_unknown_keys(latest.error_payload),
    public.oci_transition_payload_missing_required(latest.new_status, latest.error_payload),
    'phase23b_warning_mode'
  )
  FROM (
    SELECT DISTINCT ON (t.queue_id)
      t.queue_id,
      t.actor,
      t.new_status,
      t.error_payload,
      t.created_at,
      t.id
    FROM public.oci_queue_transitions AS t
    WHERE t.queue_id = ANY(v_queue_ids)
    ORDER BY t.queue_id, t.created_at DESC, t.id DESC
  ) AS latest
  JOIN public.offline_conversion_queue AS q
    ON q.id = latest.queue_id
  WHERE COALESCE(array_length(public.oci_transition_payload_unknown_keys(latest.error_payload), 1), 0) > 0
     OR COALESCE(array_length(public.oci_transition_payload_missing_required(latest.new_status, latest.error_payload), 1), 0) > 0;

  WITH latest AS (
    SELECT DISTINCT ON (t.queue_id)
      t.id,
      t.queue_id,
      t.new_status,
      t.error_payload
    FROM public.oci_queue_transitions AS t
    WHERE t.queue_id = ANY(v_queue_ids)
    ORDER BY t.queue_id, t.created_at DESC, t.id DESC
  )
  SELECT l.id, l.queue_id
  INTO v_noop_transition_id, v_noop_queue_id
  FROM latest AS l
  JOIN public.offline_conversion_queue AS q
    ON q.id = l.queue_id
  WHERE l.new_status = q.status
    AND NOT public.queue_transition_payload_has_meaningful_patch(l.error_payload)
  LIMIT 1;

  IF v_noop_transition_id IS NOT NULL THEN
    RAISE EXCEPTION 'NOOP_TRANSITION: transition % queue % already in status %',
      v_noop_transition_id, v_noop_queue_id,
      (SELECT q2.status FROM public.offline_conversion_queue AS q2 WHERE q2.id = v_noop_queue_id);
  END IF;

  WITH latest AS (
    SELECT DISTINCT ON (t.queue_id)
      t.id,
      t.queue_id,
      t.new_status,
      t.error_payload,
      t.created_at,
      t.brain_score,
      t.match_score,
      t.queue_priority,
      t.score_version,
      t.score_flags,
      t.score_explain_jsonb
    FROM public.oci_queue_transitions AS t
    WHERE t.queue_id = ANY(v_queue_ids)
    ORDER BY t.queue_id, t.created_at DESC, t.id DESC
  ),
  prepared AS (
    SELECT
      l.*,
      public.queue_transition_clear_fields(l.error_payload) AS clear_fields
    FROM latest AS l
  )
  UPDATE public.offline_conversion_queue AS q
  SET
    status = p.new_status,
    updated_at = p.created_at,
    last_error = CASE
      WHEN 'last_error' = ANY(p.clear_fields) THEN NULL
      WHEN p.error_payload ? 'last_error' AND p.error_payload->>'last_error' IS NOT NULL THEN p.error_payload->>'last_error'
      ELSE q.last_error
    END,
    provider_error_code = CASE
      WHEN 'provider_error_code' = ANY(p.clear_fields) THEN NULL
      WHEN p.error_payload ? 'provider_error_code' AND p.error_payload->>'provider_error_code' IS NOT NULL THEN p.error_payload->>'provider_error_code'
      ELSE q.provider_error_code
    END,
    provider_error_category = CASE
      WHEN 'provider_error_category' = ANY(p.clear_fields) THEN NULL
      WHEN p.error_payload ? 'provider_error_category' AND p.error_payload->>'provider_error_category' IS NOT NULL THEN p.error_payload->>'provider_error_category'
      ELSE q.provider_error_category
    END,
    attempt_count = CASE
      WHEN p.error_payload ? 'attempt_count' AND p.error_payload->>'attempt_count' IS NOT NULL THEN (p.error_payload->>'attempt_count')::int
      ELSE q.attempt_count
    END,
    retry_count = CASE
      WHEN p.error_payload ? 'retry_count' AND p.error_payload->>'retry_count' IS NOT NULL THEN (p.error_payload->>'retry_count')::int
      ELSE q.retry_count
    END,
    next_retry_at = CASE
      WHEN 'next_retry_at' = ANY(p.clear_fields) THEN NULL
      WHEN p.error_payload ? 'next_retry_at' AND p.error_payload->>'next_retry_at' IS NOT NULL THEN (p.error_payload->>'next_retry_at')::timestamptz
      ELSE q.next_retry_at
    END,
    uploaded_at = CASE
      WHEN 'uploaded_at' = ANY(p.clear_fields) THEN NULL
      WHEN p.error_payload ? 'uploaded_at' AND p.error_payload->>'uploaded_at' IS NOT NULL THEN (p.error_payload->>'uploaded_at')::timestamptz
      ELSE q.uploaded_at
    END,
    claimed_at = CASE
      WHEN 'claimed_at' = ANY(p.clear_fields) THEN NULL
      WHEN p.error_payload ? 'claimed_at' AND p.error_payload->>'claimed_at' IS NOT NULL THEN (p.error_payload->>'claimed_at')::timestamptz
      ELSE q.claimed_at
    END,
    provider_request_id = CASE
      WHEN 'provider_request_id' = ANY(p.clear_fields) THEN NULL
      WHEN p.error_payload ? 'provider_request_id' AND p.error_payload->>'provider_request_id' IS NOT NULL THEN p.error_payload->>'provider_request_id'
      ELSE q.provider_request_id
    END,
    provider_ref = CASE
      WHEN 'provider_ref' = ANY(p.clear_fields) THEN NULL
      WHEN p.error_payload ? 'provider_ref' AND p.error_payload->>'provider_ref' IS NOT NULL THEN p.error_payload->>'provider_ref'
      ELSE q.provider_ref
    END,
    block_reason = CASE
      WHEN 'block_reason' = ANY(p.clear_fields) THEN NULL
      ELSE q.block_reason
    END,
    blocked_at = CASE
      WHEN 'blocked_at' = ANY(p.clear_fields) THEN NULL
      ELSE q.blocked_at
    END,
    brain_score = COALESCE(p.brain_score, q.brain_score),
    match_score = COALESCE(p.match_score, q.match_score),
    queue_priority = COALESCE(p.queue_priority, q.queue_priority),
    score_version = COALESCE(p.score_version, q.score_version),
    score_flags = COALESCE(p.score_flags, q.score_flags),
    score_explain_jsonb = COALESCE(p.score_explain_jsonb, q.score_explain_jsonb)
  FROM prepared AS p
  WHERE q.id = p.queue_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;


CREATE OR REPLACE FUNCTION public.queue_transition_payload_has_meaningful_patch(p_payload jsonb) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  SELECT
    CASE
      WHEN p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN false
      ELSE (
        EXISTS (
          SELECT 1
          FROM jsonb_each(p_payload) AS entry
          WHERE entry.key IN (
            'last_error',
            'provider_error_code',
            'provider_error_category',
            'attempt_count',
            'retry_count',
            'next_retry_at',
            'uploaded_at',
            'claimed_at',
            'provider_request_id',
            'provider_ref'
          )
            AND entry.value IS DISTINCT FROM 'null'::jsonb
        )
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(
            CASE
              WHEN p_payload ? 'clear_fields' AND jsonb_typeof(p_payload->'clear_fields') = 'array'
                THEN p_payload->'clear_fields'
              ELSE '[]'::jsonb
            END
          ) AS clear_field
          WHERE clear_field.value IN (
            'last_error',
            'provider_error_code',
            'provider_error_category',
            'next_retry_at',
            'uploaded_at',
            'claimed_at',
            'provider_request_id',
            'provider_ref',
            'block_reason',
            'blocked_at'
          )
        )
      )
    END;
$$;


CREATE OR REPLACE FUNCTION public.append_manual_transition_batch(
  p_queue_ids uuid[],
  p_new_status text,
  p_created_at timestamptz DEFAULT now(),
  p_clear_errors boolean DEFAULT false,
  p_error_code text DEFAULT NULL::text,
  p_error_category text DEFAULT NULL::text,
  p_reason text DEFAULT NULL::text
) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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
  IF p_new_status = 'QUEUED' THEN
    v_clear_fields := v_clear_fields || ARRAY['block_reason', 'blocked_at'];
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


CREATE OR REPLACE FUNCTION public.update_queue_status_locked(
  p_ids uuid[],
  p_site_id uuid,
  p_action text,
  p_clear_errors boolean DEFAULT false,
  p_error_code text DEFAULT 'MANUAL_FAIL'::text,
  p_error_category text DEFAULT 'PERMANENT'::text,
  p_reason text DEFAULT 'MANUALLY_MARKED_FAILED'::text
) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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
        AND q.status IN ('QUEUED', 'RETRY', 'PROCESSING', 'FAILED', 'BLOCKED_PRECEDING_SIGNALS');

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

COMMIT;

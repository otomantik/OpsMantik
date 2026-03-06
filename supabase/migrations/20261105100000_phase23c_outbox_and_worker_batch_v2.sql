BEGIN;

ALTER TABLE public.outbox_events
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.outbox_events
SET updated_at = COALESCE(processed_at, created_at, now())
WHERE updated_at IS NULL;

CREATE OR REPLACE FUNCTION public.claim_outbox_events(p_limit int DEFAULT 50)
RETURNS TABLE(
  id uuid,
  payload jsonb,
  call_id uuid,
  site_id uuid,
  created_at timestamptz,
  attempt_count int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'claim_outbox_events may only be called by service_role' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  WITH locked AS (
    SELECT o.id
    FROM public.outbox_events o
    WHERE o.status = 'PENDING'
    ORDER BY o.created_at ASC
    LIMIT greatest(1, least(p_limit, 200))
    FOR UPDATE OF o SKIP LOCKED
  ),
  updated AS (
    UPDATE public.outbox_events o
    SET
      status = 'PROCESSING',
      attempt_count = o.attempt_count + 1,
      updated_at = now()
    FROM locked l
    WHERE o.id = l.id
    RETURNING o.id, o.payload, o.call_id, o.site_id, o.created_at, o.attempt_count
  )
  SELECT u.id, u.payload, u.call_id, u.site_id, u.created_at, u.attempt_count
  FROM updated u
  ORDER BY u.created_at ASC, u.id ASC;
END;
$$;

COMMENT ON FUNCTION public.claim_outbox_events(int) IS
  'OCI outbox worker: claim PENDING rows (FOR UPDATE SKIP LOCKED), set PROCESSING + updated_at, return for app to handle.';

CREATE OR REPLACE FUNCTION public.append_worker_transition_batch_v2(
  p_queue_ids uuid[],
  p_new_status text,
  p_created_at timestamptz DEFAULT now(),
  p_error_payload jsonb DEFAULT NULL
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
    RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'append_worker_transition_batch_v2 may only be called by service_role', ERRCODE = 'P0001';
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
    NULLIF(p_error_payload, '{}'::jsonb),
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

COMMENT ON FUNCTION public.append_worker_transition_batch_v2(uuid[], text, timestamptz, jsonb) IS
  'Phase 23C generic worker-owned batch append/apply path with full JSONB snapshot payload support.';

GRANT EXECUTE ON FUNCTION public.append_worker_transition_batch_v2(uuid[], text, timestamptz, jsonb) TO service_role;

COMMIT;

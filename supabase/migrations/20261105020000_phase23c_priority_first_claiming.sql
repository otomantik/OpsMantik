BEGIN;

CREATE OR REPLACE FUNCTION public.claim_offline_conversion_jobs_v3(
  p_site_id uuid,
  p_provider_key text,
  p_limit int DEFAULT 50
)
RETURNS SETOF public.offline_conversion_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit int;
  v_claimed_at timestamptz := now();
  v_candidate_queue_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'claim_offline_conversion_jobs_v3 may only be called by service_role', ERRCODE = 'P0001';
  END IF;

  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 50), 500));

  WITH candidates AS (
    SELECT oq.id, oq.queue_priority, oq.next_retry_at, oq.created_at
    FROM public.offline_conversion_queue AS oq
    JOIN public.sites AS s ON s.id = oq.site_id
    WHERE oq.site_id = p_site_id
      AND oq.provider_key = p_provider_key
      AND oq.status IN ('QUEUED', 'RETRY')
      AND (oq.next_retry_at IS NULL OR oq.next_retry_at <= v_claimed_at)
      AND s.oci_sync_method = 'api'
    ORDER BY oq.queue_priority DESC, oq.next_retry_at ASC NULLS FIRST, oq.created_at ASC, oq.id ASC
    LIMIT v_limit
    FOR UPDATE OF oq SKIP LOCKED
  )
  SELECT COALESCE(
    array_agg(id ORDER BY queue_priority DESC, next_retry_at ASC NULLS FIRST, created_at ASC, id ASC),
    ARRAY[]::uuid[]
  )
  INTO v_candidate_queue_ids
  FROM candidates;

  PERFORM public.append_rpc_claim_transition_batch(v_candidate_queue_ids, v_claimed_at);

  RETURN QUERY
  SELECT q.*
  FROM public.offline_conversion_queue AS q
  WHERE q.id = ANY(v_candidate_queue_ids)
  ORDER BY q.queue_priority DESC, q.next_retry_at ASC NULLS FIRST, q.created_at ASC, q.id ASC
  FOR UPDATE;
END;
$$;

COMMENT ON FUNCTION public.claim_offline_conversion_jobs_v3(uuid, text, int) IS
  'Phase 23C priority-first claim path. Orders by queue_priority DESC, then retry time, then creation time, then id, appends PROCESSING transitions via append_rpc_claim_transition_batch, and returns snapped queue rows.';

GRANT EXECUTE ON FUNCTION public.claim_offline_conversion_jobs_v3(uuid, text, int) TO service_role;

COMMIT;

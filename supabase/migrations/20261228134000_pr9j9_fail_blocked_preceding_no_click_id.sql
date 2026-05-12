-- PR-9J.9: terminalize permanently blocked rows that have no click id.

BEGIN;

SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_ids uuid[] := ARRAY[]::uuid[];
  v_failed integer := 0;
BEGIN
  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[])
  INTO v_ids
  FROM public.offline_conversion_queue
  WHERE provider_key = 'google_ads'
    AND status = 'BLOCKED_PRECEDING_SIGNALS'
    AND gclid IS NULL
    AND wbraid IS NULL
    AND gbraid IS NULL;

  IF COALESCE(array_length(v_ids, 1), 0) = 0 THEN
    RAISE NOTICE 'PR-9J.9: no BLOCKED_PRECEDING_SIGNALS rows without click id found';
    RETURN;
  END IF;

  SELECT public.append_worker_transition_batch_v2(
    v_ids,
    'FAILED',
    now(),
    jsonb_build_object(
      'reason', 'BLOCKED_PRECEDING_SIGNALS_NO_CLICK_ID',
      'actor', 'pr9j9_fail_blocked_preceding_no_click_id',
      'last_error', 'OCI_CONTRACT_VIOLATION: Missing Click ID (GCLID/GBRAID/WBRAID)',
      'provider_error_code', 'MISSING_CLICK_ID',
      'provider_error_category', 'DETERMINISTIC_SKIP',
      'clear_fields', jsonb_build_array('next_retry_at', 'claimed_at', 'provider_request_id', 'provider_ref')
    )
  )
  INTO v_failed;

  RAISE NOTICE 'PR-9J.9: failed % permanently blocked no-click-id rows', COALESCE(v_failed, 0);
END;
$$;

COMMIT;

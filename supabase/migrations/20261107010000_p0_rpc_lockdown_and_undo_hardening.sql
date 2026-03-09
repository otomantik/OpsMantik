BEGIN;

CREATE OR REPLACE FUNCTION public.review_call_sale_time_v1(
  p_call_id uuid,
  p_action text,
  p_actor_id uuid,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_call public.calls%ROWTYPE;
  v_updated public.calls%ROWTYPE;
  v_action text := lower(COALESCE(NULLIF(btrim(p_action), ''), ''));
  v_next_review_status text;
  v_next_oci_status text;
  v_now timestamptz := now();
  v_uid uuid := auth.uid();
BEGIN
  IF p_call_id IS NULL THEN
    RAISE EXCEPTION 'call_id_required' USING ERRCODE = '22023';
  END IF;

  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'actor_id_required' USING ERRCODE = '22023';
  END IF;

  IF v_action NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'invalid_review_action' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_call
  FROM public.calls c
  WHERE c.id = p_call_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'call_not_found' USING ERRCODE = '02000';
  END IF;

  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF v_uid IS NULL OR p_actor_id IS DISTINCT FROM v_uid OR NOT public.can_access_site(v_uid, v_call.site_id) THEN
      RAISE EXCEPTION 'access_denied' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF COALESCE(v_call.sale_review_status, 'NONE') <> 'PENDING_APPROVAL' THEN
    RAISE EXCEPTION 'call_sale_not_pending_approval' USING ERRCODE = 'P0001';
  END IF;

  v_next_review_status := CASE WHEN v_action = 'approve' THEN 'APPROVED' ELSE 'REJECTED' END;
  v_next_oci_status := CASE
    WHEN v_action = 'approve' THEN
      CASE
        WHEN v_call.lead_score = 100 THEN 'sealed'
        WHEN v_call.lead_score IS NOT NULL AND v_call.lead_score >= 10 THEN 'intent'
        ELSE 'skipped'
      END
    ELSE 'pending_approval'
  END;

  UPDATE public.calls
  SET
    sale_review_status = v_next_review_status,
    sale_review_requested_at = CASE WHEN v_action = 'approve' THEN NULL ELSE sale_review_requested_at END,
    oci_status = v_next_oci_status,
    oci_status_updated_at = v_now,
    updated_at = v_now,
    version = version + 1
  WHERE id = p_call_id
  RETURNING * INTO v_updated;

  IF v_action = 'approve' AND v_next_oci_status <> 'skipped' THEN
    INSERT INTO public.outbox_events (event_type, payload, call_id, site_id, status)
    VALUES (
      'IntentSealed',
      jsonb_build_object(
        'call_id', v_updated.id,
        'site_id', v_updated.site_id,
        'lead_score', v_updated.lead_score,
        'confirmed_at', v_updated.confirmed_at,
        'created_at', v_updated.created_at,
        'sale_amount', v_updated.sale_amount,
        'currency', COALESCE(v_updated.currency, 'TRY'),
        'oci_status', v_updated.oci_status,
        'sale_occurred_at', v_updated.sale_occurred_at,
        'sale_source_timestamp', v_updated.sale_source_timestamp,
        'sale_time_confidence', v_updated.sale_time_confidence,
        'sale_occurred_at_source', v_updated.sale_occurred_at_source,
        'sale_entry_reason', v_updated.sale_entry_reason
      ),
      v_updated.id,
      v_updated.site_id,
      'PENDING'
    );
  END IF;

  INSERT INTO public.call_actions (call_id, site_id, action_type, actor_type, actor_id, previous_status, new_status, revert_snapshot, metadata)
  VALUES (
    v_updated.id,
    v_updated.site_id,
    CASE WHEN v_action = 'approve' THEN 'sale_review_approve' ELSE 'sale_review_reject' END,
    CASE WHEN auth.role() = 'service_role' THEN 'system' ELSE 'user' END,
    p_actor_id,
    v_call.status,
    v_updated.status,
    to_jsonb(v_call),
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'previous_review_status', v_call.sale_review_status,
      'next_review_status', v_updated.sale_review_status,
      'next_oci_status', v_updated.oci_status
    )
  );

  RETURN to_jsonb(v_updated);
END;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_confirmed_sale_queue_v1(p_sale_id uuid)
RETURNS TABLE(sale_id uuid, enqueued boolean, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sale public.sales%ROWTYPE;
  v_primary_source jsonb;
  v_primary_session_id uuid;
  v_consent_scopes text[];
  v_external_id text;
  v_queue_id uuid;
  v_uid uuid := auth.uid();
BEGIN
  IF p_sale_id IS NULL THEN
    RAISE EXCEPTION 'sale_id_required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_sale
  FROM public.sales s
  WHERE s.id = p_sale_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT p_sale_id, false, 'sale_not_found'::text;
    RETURN;
  END IF;

  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF v_uid IS NULL OR NOT public.can_access_site(v_uid, v_sale.site_id) THEN
      RAISE EXCEPTION 'access_denied' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF v_sale.status IS DISTINCT FROM 'CONFIRMED' THEN
    RETURN QUERY SELECT p_sale_id, false, 'sale_not_confirmed'::text;
    RETURN;
  END IF;

  IF v_sale.amount_cents IS NULL OR v_sale.amount_cents <= 0 THEN
    RETURN QUERY SELECT p_sale_id, false, 'value_non_positive'::text;
    RETURN;
  END IF;

  IF v_sale.conversation_id IS NULL THEN
    RETURN QUERY SELECT p_sale_id, false, 'conversation_missing'::text;
    RETURN;
  END IF;

  SELECT c.primary_source, c.primary_session_id
  INTO v_primary_source, v_primary_session_id
  FROM public.conversations c
  WHERE c.id = v_sale.conversation_id
  LIMIT 1;

  IF v_primary_session_id IS NULL THEN
    RETURN QUERY SELECT p_sale_id, false, 'conversation_session_missing'::text;
    RETURN;
  END IF;

  SELECT s.consent_scopes
  INTO v_consent_scopes
  FROM public.sessions s
  WHERE s.id = v_primary_session_id
    AND s.site_id = v_sale.site_id
  LIMIT 1;

  IF v_consent_scopes IS NULL OR NOT ('marketing' = ANY(v_consent_scopes)) THEN
    RETURN QUERY SELECT p_sale_id, false, 'marketing_consent_required'::text;
    RETURN;
  END IF;

  v_external_id := public.compute_offline_conversion_external_id(
    'google_ads',
    'purchase',
    v_sale.id,
    NULL,
    v_primary_session_id
  );

  INSERT INTO public.offline_conversion_queue (
    site_id,
    sale_id,
    session_id,
    provider_key,
    external_id,
    conversion_time,
    occurred_at,
    source_timestamp,
    time_confidence,
    occurred_at_source,
    entry_reason,
    value_cents,
    currency,
    gclid,
    wbraid,
    gbraid,
    status
  )
  VALUES (
    v_sale.site_id,
    v_sale.id,
    v_primary_session_id,
    'google_ads',
    v_external_id,
    v_sale.occurred_at,
    v_sale.occurred_at,
    v_sale.occurred_at,
    'observed',
    'sale',
    v_sale.entry_reason,
    v_sale.amount_cents,
    v_sale.currency,
    NULLIF(btrim(COALESCE(v_primary_source->>'gclid', '')), ''),
    NULLIF(btrim(COALESCE(v_primary_source->>'wbraid', '')), ''),
    NULLIF(btrim(COALESCE(v_primary_source->>'gbraid', '')), ''),
    'QUEUED'
  )
  ON CONFLICT (site_id, provider_key, external_id)
  WHERE external_id IS NOT NULL
    AND status <> 'VOIDED_BY_REVERSAL'
  DO NOTHING
  RETURNING id INTO v_queue_id;

  IF v_queue_id IS NULL THEN
    RETURN QUERY SELECT p_sale_id, false, 'already_queued'::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT p_sale_id, true, 'enqueued'::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.undo_last_action_v1(
  p_call_id uuid,
  p_actor_type text DEFAULT 'user',
  p_actor_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := now();
  v_actor_type text;
  v_actor_id uuid;
  v_current public.calls%ROWTYPE;
  v_site_id uuid;
  v_last_action record;
  v_prev jsonb;
  v_prev_status text;
  v_new_status text;
  v_revert_of_undo jsonb;
  v_updated public.calls%ROWTYPE;
BEGIN
  IF p_call_id IS NULL THEN
    RAISE EXCEPTION 'call_id_required' USING ERRCODE = '22023';
  END IF;

  v_actor_type := COALESCE(NULLIF(btrim(lower(p_actor_type)), ''), 'user');
  IF v_actor_type NOT IN ('user','system') THEN
    RAISE EXCEPTION 'invalid_actor_type' USING ERRCODE = '22023';
  END IF;

  IF v_actor_type = 'user' THEN
    v_actor_id := auth.uid();
    IF v_actor_id IS NULL THEN
      RAISE EXCEPTION 'unauthorized' USING ERRCODE = '28000';
    END IF;
  ELSE
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION 'unauthorized' USING ERRCODE = '28000';
    END IF;
    v_actor_id := p_actor_id;
  END IF;

  SELECT * INTO v_current
  FROM public.calls c
  WHERE c.id = p_call_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'call_not_found' USING ERRCODE = '02000';
  END IF;

  v_site_id := v_current.site_id;

  SELECT
    a.id,
    a.action_type,
    a.previous_status,
    a.new_status,
    a.revert_snapshot,
    a.created_at
  INTO v_last_action
  FROM public.call_actions a
  WHERE a.call_id = p_call_id
  ORDER BY a.created_at DESC, a.id DESC
  LIMIT 1;

  IF v_last_action IS NULL THEN
    RAISE EXCEPTION 'no_actions_to_undo' USING ERRCODE = '22023';
  END IF;

  IF v_last_action.action_type = 'undo' THEN
    RAISE EXCEPTION 'last_action_is_undo' USING ERRCODE = '40900';
  END IF;

  v_prev := v_last_action.revert_snapshot;
  IF v_prev IS NULL OR jsonb_typeof(v_prev) <> 'object' THEN
    RAISE EXCEPTION 'invalid_revert_snapshot' USING ERRCODE = '22023';
  END IF;

  v_prev_status := v_current.status;
  v_new_status := NULLIF(btrim(COALESCE(v_prev->>'status','')), '');
  v_revert_of_undo := to_jsonb(v_current);

  UPDATE public.calls
  SET
    status = v_new_status,
    sale_amount = CASE WHEN v_prev ? 'sale_amount' AND NULLIF(btrim(COALESCE(v_prev->>'sale_amount','')), '') IS NOT NULL
      THEN (v_prev->>'sale_amount')::numeric ELSE NULL END,
    estimated_value = CASE WHEN v_prev ? 'estimated_value' AND NULLIF(btrim(COALESCE(v_prev->>'estimated_value','')), '') IS NOT NULL
      THEN (v_prev->>'estimated_value')::numeric ELSE NULL END,
    currency = COALESCE(NULLIF(btrim(COALESCE(v_prev->>'currency','')), ''), v_current.currency),
    confirmed_at = CASE WHEN v_prev ? 'confirmed_at' AND NULLIF(btrim(COALESCE(v_prev->>'confirmed_at','')), '') IS NOT NULL
      THEN (v_prev->>'confirmed_at')::timestamptz ELSE NULL END,
    confirmed_by = CASE WHEN v_prev ? 'confirmed_by' AND NULLIF(btrim(COALESCE(v_prev->>'confirmed_by','')), '') IS NOT NULL
      THEN (v_prev->>'confirmed_by')::uuid ELSE NULL END,
    cancelled_at = CASE WHEN v_prev ? 'cancelled_at' AND NULLIF(btrim(COALESCE(v_prev->>'cancelled_at','')), '') IS NOT NULL
      THEN (v_prev->>'cancelled_at')::timestamptz ELSE NULL END,
    note = CASE WHEN v_prev ? 'note' THEN NULLIF(v_prev->>'note','') ELSE NULL END,
    lead_score = CASE WHEN v_prev ? 'lead_score' AND NULLIF(btrim(COALESCE(v_prev->>'lead_score','')), '') IS NOT NULL
      THEN (v_prev->>'lead_score')::integer ELSE NULL END,
    oci_status = CASE WHEN v_prev ? 'oci_status' THEN NULLIF(v_prev->>'oci_status','') ELSE NULL END,
    oci_status_updated_at = CASE WHEN v_prev ? 'oci_status_updated_at' AND NULLIF(btrim(COALESCE(v_prev->>'oci_status_updated_at','')), '') IS NOT NULL
      THEN (v_prev->>'oci_status_updated_at')::timestamptz ELSE NULL END,
    caller_phone_raw = CASE WHEN v_prev ? 'caller_phone_raw' THEN NULLIF(v_prev->>'caller_phone_raw','') ELSE NULL END,
    caller_phone_e164 = CASE WHEN v_prev ? 'caller_phone_e164' THEN NULLIF(v_prev->>'caller_phone_e164','') ELSE NULL END,
    caller_phone_hash_sha256 = CASE WHEN v_prev ? 'caller_phone_hash_sha256' THEN NULLIF(v_prev->>'caller_phone_hash_sha256','') ELSE NULL END,
    phone_source_type = CASE WHEN v_prev ? 'phone_source_type' THEN NULLIF(v_prev->>'phone_source_type','') ELSE NULL END,
    sale_occurred_at = CASE WHEN v_prev ? 'sale_occurred_at' AND NULLIF(btrim(COALESCE(v_prev->>'sale_occurred_at','')), '') IS NOT NULL
      THEN (v_prev->>'sale_occurred_at')::timestamptz ELSE NULL END,
    sale_source_timestamp = CASE WHEN v_prev ? 'sale_source_timestamp' AND NULLIF(btrim(COALESCE(v_prev->>'sale_source_timestamp','')), '') IS NOT NULL
      THEN (v_prev->>'sale_source_timestamp')::timestamptz ELSE NULL END,
    sale_time_confidence = CASE WHEN v_prev ? 'sale_time_confidence' THEN NULLIF(v_prev->>'sale_time_confidence','') ELSE NULL END,
    sale_occurred_at_source = CASE WHEN v_prev ? 'sale_occurred_at_source' THEN NULLIF(v_prev->>'sale_occurred_at_source','') ELSE NULL END,
    sale_entry_reason = CASE WHEN v_prev ? 'sale_entry_reason' THEN NULLIF(v_prev->>'sale_entry_reason','') ELSE NULL END,
    sale_is_backdated = CASE WHEN v_prev ? 'sale_is_backdated'
      THEN COALESCE((v_prev->>'sale_is_backdated')::boolean, false) ELSE false END,
    sale_backdated_seconds = CASE WHEN v_prev ? 'sale_backdated_seconds' AND NULLIF(btrim(COALESCE(v_prev->>'sale_backdated_seconds','')), '') IS NOT NULL
      THEN (v_prev->>'sale_backdated_seconds')::integer ELSE NULL END,
    sale_review_status = CASE WHEN v_prev ? 'sale_review_status' THEN NULLIF(v_prev->>'sale_review_status','') ELSE NULL END,
    sale_review_requested_at = CASE WHEN v_prev ? 'sale_review_requested_at' AND NULLIF(btrim(COALESCE(v_prev->>'sale_review_requested_at','')), '') IS NOT NULL
      THEN (v_prev->>'sale_review_requested_at')::timestamptz ELSE NULL END,
    updated_at = v_now,
    version = COALESCE(v_current.version, 0) + 1
  WHERE id = p_call_id
  RETURNING * INTO v_updated;

  INSERT INTO public.call_actions (
    call_id,
    site_id,
    action_type,
    actor_type,
    actor_id,
    previous_status,
    new_status,
    revert_snapshot,
    metadata
  ) VALUES (
    p_call_id,
    v_site_id,
    'undo',
    v_actor_type,
    v_actor_id,
    v_prev_status,
    v_new_status,
    v_revert_of_undo,
    jsonb_build_object(
      'undone_action_id', v_last_action.id,
      'undone_action_type', v_last_action.action_type,
      'meta', COALESCE(p_metadata, '{}'::jsonb)
    )
  );

  RETURN to_jsonb(v_updated);
END;
$$;

COMMIT;

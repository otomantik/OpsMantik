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
    'user',
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

COMMENT ON FUNCTION public.review_call_sale_time_v1(uuid, text, uuid, jsonb) IS
  'Atomically approves or rejects backdated call sale times, updating calls and emitting IntentSealed outbox rows in the same transaction.';

REVOKE ALL ON FUNCTION public.review_call_sale_time_v1(uuid, text, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_call_sale_time_v1(uuid, text, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_call_sale_time_v1(uuid, text, uuid, jsonb) TO service_role;

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
  ON CONFLICT (site_id, provider_key, external_id) WHERE external_id IS NOT NULL AND archived_at IS NULL
  DO NOTHING
  RETURNING id INTO v_queue_id;

  IF v_queue_id IS NULL THEN
    RETURN QUERY SELECT p_sale_id, false, 'already_queued'::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT p_sale_id, true, 'enqueued'::text;
END;
$$;

COMMENT ON FUNCTION public.reconcile_confirmed_sale_queue_v1(uuid) IS
  'Canonical backfill/reconcile path for confirmed sales missing an offline_conversion_queue row. Reuses DB-owned queue shape and dedup invariants.';

REVOKE ALL ON FUNCTION public.reconcile_confirmed_sale_queue_v1(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconcile_confirmed_sale_queue_v1(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_confirmed_sale_queue_v1(uuid) TO service_role;

COMMIT;

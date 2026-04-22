-- Residual integrity closure:
-- Enforce optimistic version for user-origin mutations even when invoked by service-role client.

BEGIN;

CREATE OR REPLACE FUNCTION public.apply_call_action_v2(
  p_call_id uuid,
  p_site_id uuid,
  p_stage text,
  p_actor_id uuid,
  p_lead_score int DEFAULT NULL,
  p_sale_metadata jsonb DEFAULT NULL,
  p_version integer DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_caller_phone_raw text DEFAULT NULL,
  p_caller_phone_e164 text DEFAULT NULL,
  p_caller_phone_hash text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_call public.calls%ROWTYPE;
  v_updated public.calls%ROWTYPE;
  v_now timestamptz := now();
  v_current_stage text;
  v_target_stage text := lower(btrim(p_stage));
  v_uid uuid := auth.uid();
  v_user_origin boolean := COALESCE(p_metadata->>'mutation_origin', '') = 'user';
BEGIN
  IF p_call_id IS NULL OR p_site_id IS NULL THEN
    RAISE EXCEPTION 'call_id_and_site_id_required' USING ERRCODE = '22023';
  END IF;

  IF v_target_stage NOT IN ('junk', 'contacted', 'offered', 'won') THEN
    RAISE EXCEPTION 'invalid_pipeline_stage (%)', p_stage USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_call
  FROM public.calls c
  WHERE c.id = p_call_id AND c.site_id = p_site_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'call_not_found' USING ERRCODE = '02000';
  END IF;

  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF v_uid IS NULL OR NOT public.can_access_site(v_uid, v_call.site_id) THEN
      RAISE EXCEPTION 'access_denied' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF (v_user_origin OR auth.role() IS DISTINCT FROM 'service_role') AND (p_version IS NULL OR p_version < 1) THEN
    RAISE EXCEPTION 'invalid_version' USING ERRCODE = '22023';
  END IF;

  IF p_version IS NOT NULL AND v_call.version IS DISTINCT FROM p_version THEN
    RAISE EXCEPTION 'concurrency_conflict' USING ERRCODE = '40900';
  END IF;

  v_current_stage := CASE
    WHEN v_call.status = 'junk' THEN 'junk'
    WHEN v_call.oci_status = 'sealed' THEN 'won'
    WHEN v_call.oci_status = 'intent' THEN COALESCE(v_call.optimization_stage, 'contacted')
    ELSE 'none'
  END;

  IF v_current_stage = 'won' AND v_target_stage <> 'junk' AND v_target_stage <> 'won' THEN
    RAISE EXCEPTION 'illegal_transition_from_won_requires_junk_reset (%)', v_target_stage USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.calls
  SET
    status = CASE WHEN v_target_stage = 'junk' THEN 'junk' ELSE 'confirmed' END,
    oci_status = CASE
      WHEN v_target_stage = 'junk' THEN 'skipped'
      WHEN v_target_stage = 'won' THEN 'sealed'
      ELSE 'intent'
    END,
    optimization_stage = v_target_stage,
    lead_score = COALESCE(p_lead_score, lead_score),
    caller_phone_raw = COALESCE(p_caller_phone_raw, caller_phone_raw),
    caller_phone_e164 = COALESCE(p_caller_phone_e164, caller_phone_e164),
    caller_phone_hash_sha256 = COALESCE(p_caller_phone_hash, caller_phone_hash_sha256),
    phone_source_type = CASE WHEN p_caller_phone_e164 IS NOT NULL THEN 'operator_verified' ELSE phone_source_type END,
    sale_amount = CASE WHEN v_target_stage = 'won' THEN COALESCE((p_sale_metadata->>'amount')::numeric, sale_amount) ELSE sale_amount END,
    currency = CASE WHEN v_target_stage = 'won' THEN COALESCE(p_sale_metadata->>'currency', currency) ELSE currency END,
    sale_occurred_at = CASE WHEN v_target_stage = 'won' THEN COALESCE((p_sale_metadata->>'occurred_at')::timestamptz, sale_occurred_at) ELSE sale_occurred_at END,
    oci_status_updated_at = v_now,
    confirmed_at = CASE WHEN v_target_stage IN ('contacted', 'offered', 'won') THEN COALESCE(confirmed_at, v_now) ELSE confirmed_at END,
    confirmed_by = CASE WHEN v_target_stage IN ('contacted', 'offered', 'won') THEN COALESCE(confirmed_by, p_actor_id) ELSE confirmed_by END,
    updated_at = v_now,
    version = version + 1
  WHERE id = p_call_id
  RETURNING * INTO v_updated;

  INSERT INTO public.call_actions (
    call_id, site_id, action_type, actor_type, actor_id,
    previous_status, new_status, revert_snapshot, metadata
  )
  VALUES (
    v_updated.id, v_updated.site_id, 'qualify_' || v_target_stage,
    CASE WHEN auth.role() = 'service_role' THEN 'system' ELSE 'user' END,
    p_actor_id, v_call.status, v_updated.status, to_jsonb(v_call),
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'prev_stage', v_current_stage,
      'next_stage', v_target_stage,
      'rpc_version', 'v2'
    )
  );

  IF v_target_stage IN ('contacted', 'offered', 'won') THEN
    INSERT INTO public.outbox_events (event_type, payload, call_id, site_id, status)
    VALUES (
      CASE WHEN v_target_stage = 'won' THEN 'IntentSealed' ELSE 'StageUpdated' END,
      jsonb_build_object(
        'call_id', v_updated.id,
        'site_id', v_updated.site_id,
        'stage', v_target_stage,
        'lead_score', v_updated.lead_score,
        'confirmed_at', v_updated.confirmed_at,
        'created_at', v_updated.created_at,
        'sale_amount', v_updated.sale_amount,
        'currency', COALESCE(v_updated.currency, 'TRY'),
        'oci_status', v_updated.oci_status,
        'sale_occurred_at', v_updated.sale_occurred_at,
        'phone_e164', v_updated.caller_phone_e164,
        'phone_hash', v_updated.caller_phone_hash_sha256
      ),
      v_updated.id,
      v_updated.site_id,
      'PENDING'
    );
  END IF;

  RETURN to_jsonb(v_updated);
END;
$$;

COMMIT;

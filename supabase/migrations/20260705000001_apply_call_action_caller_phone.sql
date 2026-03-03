-- Operator-Verified Caller Phone: apply_call_action_v1 accepts and persists caller_phone fields.
-- Only in seal/confirm branch. set_config immediately before UPDATE; Least Privilege.

CREATE OR REPLACE FUNCTION public.apply_call_action_v1(
  p_call_id uuid,
  p_action_type text,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_actor_type text DEFAULT 'user',
  p_actor_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_version integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_call public.calls%ROWTYPE;
  v_site_id uuid;
  v_prev_status text;
  v_new_status text;
  v_now timestamptz := now();
  v_actor_type text;
  v_actor_id uuid;
  v_revert jsonb;
  v_updated public.calls%ROWTYPE;
  v_sale_amount numeric;
  v_currency text;
  v_lead_score integer;
  v_has_caller_phone boolean;
BEGIN
  IF p_call_id IS NULL THEN
    RAISE EXCEPTION 'call_id_required' USING ERRCODE = '22023';
  END IF;

  v_actor_type := COALESCE(NULLIF(btrim(lower(p_actor_type)), ''), 'user');
  IF v_actor_type = 'user' THEN
    v_actor_id := auth.uid();
    IF v_actor_id IS NULL THEN
      RAISE EXCEPTION 'unauthorized' USING ERRCODE = '28000';
    END IF;
  ELSE
    v_actor_id := p_actor_id;
  END IF;

  SELECT * INTO v_call
  FROM public.calls c
  WHERE c.id = p_call_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'call_not_found' USING ERRCODE = '02000';
  END IF;

  IF p_version IS NOT NULL AND v_call.version IS DISTINCT FROM p_version THEN
    RAISE EXCEPTION 'concurrency_conflict: version mismatch' USING ERRCODE = 'P0002';
  END IF;

  v_site_id := v_call.site_id;
  v_prev_status := v_call.status;
  v_revert := to_jsonb(v_call);

  IF lower(p_action_type) IN ('seal','confirm','confirmed','auto_approve') THEN
    IF v_prev_status IN ('junk', 'cancelled') THEN
      RAISE EXCEPTION 'cannot_seal_from_junk_or_cancelled' USING ERRCODE = 'P0003';
    END IF;
  END IF;

  IF (p_payload ? 'sale_amount') THEN
    v_sale_amount := (p_payload->>'sale_amount')::numeric;
  END IF;
  v_currency := COALESCE(p_payload->>'currency', v_call.currency);
  IF (p_payload ? 'lead_score') THEN
    v_lead_score := (p_payload->>'lead_score')::int;
  END IF;

  v_has_caller_phone := (p_payload ? 'caller_phone_raw') OR (p_payload ? 'caller_phone_e164') OR (p_payload ? 'caller_phone_hash_sha256');

  IF lower(p_action_type) IN ('seal','confirm','confirmed','auto_approve') THEN
    v_new_status := 'confirmed';
    -- Session flag: allow caller_phone_* write. Transaction-local; no reset needed.
    IF v_has_caller_phone THEN
      PERFORM set_config('app.allow_caller_phone', '1', true);
    END IF;
    UPDATE public.calls
    SET
      status = v_new_status,
      sale_amount = v_sale_amount,
      currency = v_currency,
      confirmed_at = v_now,
      confirmed_by = CASE WHEN v_actor_type = 'user' THEN v_actor_id ELSE NULL END,
      version = version + 1,
      lead_score = COALESCE(v_lead_score, lead_score),
      oci_status = 'sealed',
      oci_status_updated_at = v_now,
      caller_phone_raw = CASE WHEN (p_payload ? 'caller_phone_raw') THEN NULLIF(btrim(p_payload->>'caller_phone_raw'), '') ELSE caller_phone_raw END,
      caller_phone_e164 = CASE WHEN (p_payload ? 'caller_phone_e164') THEN NULLIF(btrim(p_payload->>'caller_phone_e164'), '') ELSE caller_phone_e164 END,
      caller_phone_hash_sha256 = CASE WHEN (p_payload ? 'caller_phone_hash_sha256') THEN NULLIF(btrim(p_payload->>'caller_phone_hash_sha256'), '') ELSE caller_phone_hash_sha256 END,
      phone_source_type = CASE WHEN v_has_caller_phone THEN 'operator_verified' ELSE phone_source_type END
    WHERE id = p_call_id
    RETURNING * INTO v_updated;

  ELSIF lower(p_action_type) IN ('junk','ai_junk') THEN
    v_new_status := 'junk';
    UPDATE public.calls
    SET
      status = v_new_status,
      version = version + 1,
      cancelled_at = NULL,
      oci_status = NULL,
      oci_status_updated_at = v_now
    WHERE id = p_call_id
    RETURNING * INTO v_updated;

  ELSIF lower(p_action_type) IN ('cancel','cancelled') THEN
    v_new_status := 'cancelled';
    UPDATE public.calls
    SET
      status = v_new_status,
      version = version + 1,
      cancelled_at = v_now,
      oci_status = NULL,
      oci_status_updated_at = v_now
    WHERE id = p_call_id
    RETURNING * INTO v_updated;

  ELSE
    UPDATE public.calls
    SET
      status = COALESCE(v_new_status, status),
      version = version + 1,
      updated_at = v_now
    WHERE id = p_call_id
    RETURNING * INTO v_updated;
  END IF;

  INSERT INTO public.call_actions (call_id, site_id, action_type, actor_type, actor_id, previous_status, new_status, revert_snapshot, metadata)
  VALUES (p_call_id, v_site_id, lower(p_action_type), v_actor_type, v_actor_id, v_prev_status, v_new_status, v_revert, p_metadata);

  RETURN to_jsonb(v_updated);
END;
$$;

COMMENT ON FUNCTION public.apply_call_action_v1(uuid, text, jsonb, text, uuid, jsonb, integer) IS
  'Seal/confirm branch accepts caller_phone_raw, caller_phone_e164, caller_phone_hash_sha256; sets phone_source_type=operator_verified when caller phone provided.';

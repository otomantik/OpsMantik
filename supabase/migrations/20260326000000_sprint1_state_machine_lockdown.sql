-- Sprint 1: State Machine Lockdown — Junk/Cancelled cannot be sealed at DB level
-- Makes Junk -> Sealed and Cancelled -> Sealed physically impossible (cannot_seal_from_junk_or_cancelled, P0003).

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

  -- Sprint 1: Hard guard — cannot seal from junk or cancelled (state machine lockdown)
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

  IF lower(p_action_type) IN ('seal','confirm','confirmed','auto_approve') THEN
    v_new_status := 'confirmed';
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
      oci_status_updated_at = v_now
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
  'Sprint 1: Seal from junk/cancelled raises P0003 cannot_seal_from_junk_or_cancelled. Optimistic lock P0002.';

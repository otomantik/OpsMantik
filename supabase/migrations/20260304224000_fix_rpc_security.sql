-- Migration: HOTFIX Restore Intent Qualification
-- 1. SECURITY DEFINER: Allow RPC to bypass RLS for internal writes (outbox, audit).
-- 2. PLIANT oci_status: Allow API to override oci_status (e.g. 'skipped' for low-score confirmed leads).

BEGIN;

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
SECURITY DEFINER -- CRITICAL FIX: Run as owner to write to outbox/audit despite user RLS
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
  v_oci_status text;
BEGIN
  IF p_call_id IS NULL THEN
    RAISE EXCEPTION 'call_id_required' USING ERRCODE = '22023';
  END IF;

  v_actor_type := COALESCE(NULLIF(btrim(lower(p_actor_type)), ''), 'user');

  -- auth.uid() still works in SECURITY DEFINER to get the actual calling user
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

  IF (p_payload ? 'sale_amount') THEN
    v_sale_amount := (p_payload->>'sale_amount')::numeric;
  END IF;
  v_currency := COALESCE(p_payload->>'currency', v_call.currency);
  IF (p_payload ? 'lead_score') THEN
    v_lead_score := (p_payload->>'lead_score')::int;
  END IF;
  -- Allow API to explicitly specify oci_status (e.g. 'skipped' or 'sealed' or 'intent')
  IF (p_payload ? 'oci_status') THEN
    v_oci_status := p_payload->>'oci_status';
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
      oci_status = COALESCE(v_oci_status, 'sealed'), -- Default to sealed if not overridden
      oci_status_updated_at = v_now
    WHERE id = p_call_id
    RETURNING * INTO v_updated;

    -- Phase 1 Outbox: only write if oci_status is NOT skipped (save worker cycles)
    IF v_updated.oci_status IS DISTINCT FROM 'skipped' THEN
      INSERT INTO public.outbox_events (event_type, payload, call_id, site_id, status)
      VALUES (
        'IntentSealed',
        jsonb_build_object(
          'call_id', p_call_id,
          'site_id', v_site_id,
          'lead_score', v_updated.lead_score,
          'confirmed_at', v_updated.confirmed_at,
          'created_at', v_updated.created_at,
          'sale_amount', v_updated.sale_amount,
          'currency', COALESCE(v_currency, v_updated.currency),
          'oci_status', v_updated.oci_status
        ),
        p_call_id,
        v_site_id,
        'PENDING'
      );
    END IF;

  ELSIF lower(p_action_type) IN ('junk','ai_junk') THEN
    v_new_status := 'junk';
    UPDATE public.calls
    SET
      status = v_new_status,
      version = version + 1,
      cancelled_at = NULL,
      oci_status = COALESCE(v_oci_status, NULL),
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
      oci_status = COALESCE(v_oci_status, NULL),
      oci_status_updated_at = v_now
    WHERE id = p_call_id
    RETURNING * INTO v_updated;

  ELSE
    UPDATE public.calls
    SET
      status = COALESCE(v_new_status, status),
      version = version + 1,
      updated_at = v_now,
      oci_status = COALESCE(v_oci_status, oci_status)
    WHERE id = p_call_id
    RETURNING * INTO v_updated;
  END IF;

  INSERT INTO public.call_actions (call_id, site_id, action_type, actor_type, actor_id, previous_status, new_status, revert_snapshot, metadata)
  VALUES (p_call_id, v_site_id, lower(p_action_type), v_actor_type, v_actor_id, v_prev_status, v_new_status, v_revert, p_metadata);

  RETURN to_jsonb(v_updated);
END;
$$;

-- 3. GRANTS: Ensure authenticated users can call the new signature
REVOKE ALL ON FUNCTION public.apply_call_action_v1(uuid, text, jsonb, text, uuid, jsonb, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_call_action_v1(uuid, text, jsonb, text, uuid, jsonb, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_call_action_v1(uuid, text, jsonb, text, uuid, jsonb, integer) TO service_role;

-- 4. TRIGGER: Allow score_breakdown updates for junk/manual scoring
CREATE OR REPLACE FUNCTION public.calls_enforce_update_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Allowed columns: sale_amount, estimated_value, currency, status, confirmed_at, confirmed_by, cancelled_at,
  -- note, lead_score, oci_status, oci_status_updated_at, updated_at, VERSION, and SCORE_BREAKDOWN.
  IF OLD.id IS DISTINCT FROM NEW.id
     OR OLD.site_id IS DISTINCT FROM NEW.site_id
     OR OLD.phone_number IS DISTINCT FROM NEW.phone_number
     OR OLD.matched_session_id IS DISTINCT FROM NEW.matched_session_id
     OR OLD.matched_fingerprint IS DISTINCT FROM NEW.matched_fingerprint
     OR OLD.created_at IS DISTINCT FROM NEW.created_at
     OR OLD.intent_page_url IS DISTINCT FROM NEW.intent_page_url
     OR OLD.click_id IS DISTINCT FROM NEW.click_id
     OR OLD.source IS DISTINCT FROM NEW.source
     OR OLD.intent_action IS DISTINCT FROM NEW.intent_action
     OR OLD.intent_target IS DISTINCT FROM NEW.intent_target
     OR OLD.intent_stamp IS DISTINCT FROM NEW.intent_stamp
     OR OLD.oci_uploaded_at IS DISTINCT FROM NEW.oci_uploaded_at
     OR OLD.oci_matched_at IS DISTINCT FROM NEW.oci_matched_at
     OR OLD.oci_batch_id IS DISTINCT FROM NEW.oci_batch_id
     OR OLD.oci_error IS DISTINCT FROM NEW.oci_error
  THEN
    RAISE EXCEPTION 'calls: only UI fields, version and score_breakdown are updatable by app'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;

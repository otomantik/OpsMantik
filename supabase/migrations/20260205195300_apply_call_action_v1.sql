-- Migration: Event-Sourcing Lite — apply_call_action_v1 RPC
-- Date: 2026-02-05
--
-- Purpose:
-- - Atomic state transitions on public.calls with append-only audit record in public.call_actions.
-- - Designed for reliable Undo (revert_snapshot captures pre-update state).
--
-- Security model:
-- - SECURITY INVOKER: relies on existing calls RLS (owner/editor/admin UPDATE) + trigger whitelist.
-- - actor_id is derived from auth.uid() when actor_type='user' (cannot spoof).
--
-- NOTE:
-- - calls_enforce_update_columns trigger did not originally allow cancelled_at updates.
--   This migration updates the trigger to permit cancelled_at mutations for authenticated users.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0) Ensure calls.status supports 'cancelled' (used by UI + kill feed)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'calls_status_check'
      AND conrelid = 'public.calls'::regclass
  ) THEN
    ALTER TABLE public.calls DROP CONSTRAINT calls_status_check;
  END IF;
END $$;

ALTER TABLE public.calls
ADD CONSTRAINT calls_status_check
CHECK (status IN ('intent', 'confirmed', 'junk', 'qualified', 'real', 'cancelled') OR status IS NULL);

-- ---------------------------------------------------------------------------
-- 1) Update calls_enforce_update_columns to allow cancelled_at updates
-- ---------------------------------------------------------------------------
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

  -- Allow only these columns to differ from OLD:
  -- sale_amount, estimated_value, currency, status, confirmed_at, confirmed_by, cancelled_at,
  -- note, lead_score, oci_status, oci_status_updated_at, updated_at (via trigger).
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
    RAISE EXCEPTION 'calls: only sale_amount, estimated_value, currency, status, confirmed_at, confirmed_by, cancelled_at, note, lead_score, oci_status, oci_status_updated_at are updatable by app'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.calls_enforce_update_columns() IS
'RLS helper: only allowed call fields updatable by authenticated users; service_role can update any column. Allows cancelled_at.';

-- ---------------------------------------------------------------------------
-- 2) RPC: apply_call_action_v1
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_call_action_v1(
  p_call_id uuid,
  p_action_type text,
  p_payload jsonb DEFAULT '{}'::jsonb,
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
  IF p_action_type IS NULL OR btrim(p_action_type) = '' THEN
    RAISE EXCEPTION 'action_type_required' USING ERRCODE = '22023';
  END IF;

  v_actor_type := COALESCE(NULLIF(btrim(lower(p_actor_type)), ''), 'user');
  IF v_actor_type NOT IN ('user','system') THEN
    RAISE EXCEPTION 'invalid_actor_type' USING ERRCODE = '22023';
  END IF;

  -- Prevent actor spoofing: user actor_id must be auth.uid().
  IF v_actor_type = 'user' THEN
    v_actor_id := auth.uid();
    IF v_actor_id IS NULL THEN
      RAISE EXCEPTION 'unauthorized' USING ERRCODE = '28000';
    END IF;
  ELSE
    -- system actor: allow explicit actor_id only if provided; otherwise NULL.
    v_actor_id := p_actor_id;
  END IF;

  -- Lock calls row (transaction-safe)
  SELECT * INTO v_call
  FROM public.calls c
  WHERE c.id = p_call_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'call_not_found' USING ERRCODE = '02000';
  END IF;

  v_site_id := v_call.site_id;
  v_prev_status := v_call.status;
  v_revert := to_jsonb(v_call);

  -- Parse commonly-used payload fields safely
  v_sale_amount := NULL;
  IF (p_payload ? 'sale_amount') THEN
    BEGIN
      v_sale_amount := NULLIF(btrim((p_payload->>'sale_amount')), '')::numeric;
    EXCEPTION WHEN others THEN
      v_sale_amount := NULL;
    END;
  END IF;

  v_currency := NULLIF(btrim(COALESCE(p_payload->>'currency', '')), '');
  v_lead_score := NULL;
  IF (p_payload ? 'lead_score') THEN
    BEGIN
      v_lead_score := NULLIF(btrim((p_payload->>'lead_score')), '')::int;
    EXCEPTION WHEN others THEN
      v_lead_score := NULL;
    END;
  END IF;

  -- Apply action (only touches allowed columns; enforced by calls_enforce_update_columns trigger)
  IF lower(p_action_type) IN ('seal','confirm','confirmed','auto_approve') THEN
    v_new_status := 'confirmed';
    UPDATE public.calls
    SET
      status = v_new_status,
      sale_amount = v_sale_amount,
      currency = COALESCE(v_currency, public.calls.currency),
      confirmed_at = v_now,
      confirmed_by = CASE WHEN v_actor_type = 'user' THEN v_actor_id ELSE NULL END,
      cancelled_at = NULL,
      lead_score = COALESCE(v_lead_score, public.calls.lead_score),
      oci_status = 'sealed',
      oci_status_updated_at = v_now
    WHERE id = p_call_id
    RETURNING * INTO v_updated;

  ELSIF lower(p_action_type) IN ('junk','ai_junk') THEN
    v_new_status := 'junk';
    UPDATE public.calls
    SET
      status = v_new_status,
      sale_amount = NULL,
      estimated_value = NULL,
      confirmed_at = NULL,
      confirmed_by = NULL,
      cancelled_at = NULL,
      lead_score = COALESCE(v_lead_score, public.calls.lead_score),
      oci_status = NULL,
      oci_status_updated_at = v_now
    WHERE id = p_call_id
    RETURNING * INTO v_updated;

  ELSIF lower(p_action_type) IN ('cancel','cancelled') THEN
    v_new_status := 'cancelled';
    UPDATE public.calls
    SET
      status = v_new_status,
      sale_amount = NULL,
      estimated_value = NULL,
      confirmed_at = NULL,
      confirmed_by = NULL,
      cancelled_at = v_now,
      oci_status = NULL,
      oci_status_updated_at = v_now
    WHERE id = p_call_id
    RETURNING * INTO v_updated;

  ELSIF lower(p_action_type) IN ('restore','undo_restore','intent') THEN
    v_new_status := 'intent';
    UPDATE public.calls
    SET
      status = v_new_status,
      sale_amount = NULL,
      estimated_value = NULL,
      confirmed_at = NULL,
      confirmed_by = NULL,
      cancelled_at = NULL,
      oci_status = NULL,
      oci_status_updated_at = v_now
    WHERE id = p_call_id
    RETURNING * INTO v_updated;

  ELSE
    RAISE EXCEPTION 'unknown_action_type: %', p_action_type USING ERRCODE = '22023';
  END IF;

  -- Insert audit log row (append-only)
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
    lower(p_action_type),
    v_actor_type,
    v_actor_id,
    v_prev_status,
    v_new_status,
    v_revert,
    jsonb_build_object(
      'payload', COALESCE(p_payload, '{}'::jsonb),
      'meta', COALESCE(p_metadata, '{}'::jsonb)
    )
  );

  RETURN to_jsonb(v_updated);
END;
$$;

COMMENT ON FUNCTION public.apply_call_action_v1(uuid, text, jsonb, text, uuid, jsonb) IS
'Event-Sourcing Lite: applies a state transition to calls (RLS) and writes an audit record to call_actions with revert_snapshot for safe Undo.';

REVOKE ALL ON FUNCTION public.apply_call_action_v1(uuid, text, jsonb, text, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_call_action_v1(uuid, text, jsonb, text, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_call_action_v1(uuid, text, jsonb, text, uuid, jsonb) TO service_role;

COMMIT;


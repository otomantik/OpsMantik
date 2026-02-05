-- Migration: Event-Sourcing Lite — undo_last_action_v1 RPC
-- Date: 2026-02-05
--
-- Purpose:
-- - Revert the most recent non-undo action on a call using call_actions.revert_snapshot.
-- - Append an 'undo' action to call_actions (history is immutable).
--
-- Security:
-- - SECURITY INVOKER, relies on calls UPDATE RLS (owner/editor/admin) for user undos.
-- - service_role can undo as system.

BEGIN;

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
    v_actor_id := p_actor_id;
  END IF;

  -- Lock call row first (prevents concurrent updates while undoing)
  SELECT * INTO v_current
  FROM public.calls c
  WHERE c.id = p_call_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'call_not_found' USING ERRCODE = '02000';
  END IF;

  v_site_id := v_current.site_id;

  -- Find last action; do not allow undoing an undo (prevents flip-flop without explicit design).
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

  -- Snapshot current state as revert_snapshot for the undo action itself.
  v_revert_of_undo := to_jsonb(v_current);

  -- Apply revert (only columns we mutate in apply_call_action_v1; safe + compatible with whitelist trigger)
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
      THEN (v_prev->>'lead_score')::int ELSE NULL END,
    oci_status = CASE WHEN v_prev ? 'oci_status' THEN NULLIF(v_prev->>'oci_status','') ELSE NULL END,
    oci_status_updated_at = CASE WHEN v_prev ? 'oci_status_updated_at' AND NULLIF(btrim(COALESCE(v_prev->>'oci_status_updated_at','')), '') IS NOT NULL
      THEN (v_prev->>'oci_status_updated_at')::timestamptz ELSE NULL END
  WHERE id = p_call_id
  RETURNING * INTO v_updated;

  -- Append undo log
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

COMMENT ON FUNCTION public.undo_last_action_v1(uuid, text, uuid, jsonb) IS
'Event-Sourcing Lite: reverts the most recent non-undo call action using revert_snapshot, and records an undo action.';

REVOKE ALL ON FUNCTION public.undo_last_action_v1(uuid, text, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.undo_last_action_v1(uuid, text, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.undo_last_action_v1(uuid, text, uuid, jsonb) TO service_role;

COMMIT;


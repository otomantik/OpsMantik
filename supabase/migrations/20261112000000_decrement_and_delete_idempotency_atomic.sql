-- Phase 12: Atomic compensation — decrement usage + delete idempotency in one transaction.
-- Prevents divergence when processSyncEvent fails: decrement succeeds but delete fails (or vice versa).
-- Replaces separate decrement_usage_compensation RPC + deleteIdempotencyKeyForCompensation call.

BEGIN;

CREATE OR REPLACE FUNCTION public.decrement_and_delete_idempotency(
  p_site_id uuid,
  p_month date,
  p_idempotency_key text,
  p_kind text DEFAULT 'revenue_events'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_service boolean;
  v_row public.usage_counters%ROWTYPE;
  v_new int := 0;
  v_deleted int := 0;
  v_usage_found boolean;
BEGIN
  v_is_service := (auth.uid() IS NULL AND public._jwt_role() = 'service_role');
  IF NOT v_is_service THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'FORBIDDEN');
  END IF;

  IF p_kind NOT IN ('revenue_events', 'oci_uploads') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'BAD_KIND');
  END IF;

  IF p_idempotency_key IS NULL OR trim(p_idempotency_key) = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'BAD_IDEMPOTENCY_KEY');
  END IF;

  -- Decrement usage (same logic as decrement_usage_compensation)
  SELECT * INTO v_row
  FROM public.usage_counters
  WHERE site_id = p_site_id AND month = p_month
  FOR UPDATE;
  v_usage_found := FOUND;

  IF v_usage_found THEN
    IF p_kind = 'revenue_events' THEN
      v_new := GREATEST(0, v_row.revenue_events_count - 1);
      UPDATE public.usage_counters
      SET revenue_events_count = v_new, updated_at = now()
      WHERE id = v_row.id;
    ELSE
      v_new := GREATEST(0, v_row.conversion_sends_count - 1);
      UPDATE public.usage_counters
      SET conversion_sends_count = v_new, updated_at = now()
      WHERE id = v_row.id;
    END IF;
  ELSE
    v_new := 0;
  END IF;

  -- Delete idempotency row (atomic with decrement above)
  WITH del AS (
    DELETE FROM public.ingest_idempotency
    WHERE site_id = p_site_id AND idempotency_key = p_idempotency_key
    RETURNING 1
  )
  SELECT count(*)::int INTO v_deleted FROM del;

  RETURN jsonb_build_object(
    'ok', true,
    'new_count', v_new,
    'usage_skipped', NOT v_usage_found,
    'idempotency_deleted', v_deleted > 0
  );
END;
$$;

COMMENT ON FUNCTION public.decrement_and_delete_idempotency(uuid, date, text, text) IS
  'Phase 12: Atomic compensation. Decrement usage + delete idempotency row in one transaction. Used when processSyncEvent fails after idempotency+usage commit. Service_role only.';

GRANT EXECUTE ON FUNCTION public.decrement_and_delete_idempotency(uuid, date, text, text) TO service_role;

COMMIT;

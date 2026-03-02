-- Extinction Patch 1.1: Phantom Billable — Compensation RPC
-- Decrements revenue_events_count by 1 (floor 0) when processSyncEvent fails after idempotency+usage commit.
-- Service_role only. Used by /api/workers/ingest on processSyncEvent throw.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.decrement_usage_compensation(
  p_site_id uuid,
  p_month date,
  p_kind text DEFAULT 'revenue_events'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_service boolean;
  v_row public.usage_counters%ROWTYPE;
  v_new int;
BEGIN
  v_is_service := (auth.uid() IS NULL AND public._jwt_role() = 'service_role');
  IF NOT v_is_service THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'FORBIDDEN');
  END IF;

  IF p_kind NOT IN ('revenue_events', 'oci_uploads') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'BAD_KIND');
  END IF;

  SELECT * INTO v_row
  FROM public.usage_counters
  WHERE site_id = p_site_id AND month = p_month
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'new_count', 0, 'skipped', true);
  END IF;

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

  RETURN jsonb_build_object('ok', true, 'new_count', v_new);
END;
$$;

COMMENT ON FUNCTION public.decrement_usage_compensation(uuid, date, text) IS
  'Compensation: decrement usage counter by 1 (floor 0). Used when processSyncEvent fails after idempotency+usage commit. Service_role only.';

GRANT EXECUTE ON FUNCTION public.decrement_usage_compensation(uuid, date, text) TO service_role;

COMMIT;

BEGIN;

CREATE OR REPLACE FUNCTION public.decrement_and_delete_idempotency(
  p_site_id uuid,
  p_month date,
  p_idempotency_key text,
  p_kind text DEFAULT 'revenue_events'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer := 0;
  v_current bigint := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role required' USING ERRCODE = 'P0001';
  END IF;

  IF p_kind <> 'revenue_events' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'UNSUPPORTED_KIND', 'kind', p_kind);
  END IF;

  DELETE FROM public.ingest_idempotency
  WHERE site_id = p_site_id
    AND idempotency_key = p_idempotency_key;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
  END IF;

  INSERT INTO public.usage_counters(site_id, month)
  VALUES (p_site_id, p_month)
  ON CONFLICT (site_id, month) DO NOTHING;

  UPDATE public.usage_counters
  SET
    revenue_events_count = GREATEST(revenue_events_count - 1, 0),
    updated_at = now()
  WHERE site_id = p_site_id
    AND month = p_month
  RETURNING revenue_events_count INTO v_current;

  RETURN jsonb_build_object(
    'ok', true,
    'deleted', true,
    'kind', p_kind,
    'current', COALESCE(v_current, 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.decrement_and_delete_idempotency(uuid, date, text, text) TO service_role;

COMMIT;

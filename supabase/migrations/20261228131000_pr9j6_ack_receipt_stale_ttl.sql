-- PR-9J.6: mark stale ACK receipts and allow same request_key re-registration.

BEGIN;

ALTER TABLE public.ack_receipt_ledger
  DROP CONSTRAINT IF EXISTS ack_receipt_ledger_apply_state_check;

ALTER TABLE public.ack_receipt_ledger
  ADD CONSTRAINT ack_receipt_ledger_apply_state_check
  CHECK (apply_state IN ('REGISTERED', 'APPLIED', 'STALE'));

CREATE OR REPLACE FUNCTION public.sweep_stale_ack_receipts_v1(
  p_min_age_minutes integer DEFAULT 60,
  p_limit integer DEFAULT 500
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_updated integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role required' USING ERRCODE = 'P0001';
  END IF;

  WITH stale AS (
    SELECT id
    FROM public.ack_receipt_ledger
    WHERE apply_state = 'REGISTERED'
      AND result_snapshot IS NULL
      AND updated_at < now() - (GREATEST(COALESCE(p_min_age_minutes, 60), 1) || ' minutes')::interval
    ORDER BY updated_at
    LIMIT GREATEST(COALESCE(p_limit, 500), 1)
  )
  UPDATE public.ack_receipt_ledger r
  SET apply_state = 'STALE',
      updated_at = now()
  FROM stale
  WHERE r.id = stale.id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

CREATE OR REPLACE FUNCTION public.register_ack_receipt_v1(
  p_site_id uuid,
  p_request_key text,
  p_payload_hash text
)
RETURNS TABLE(receipt_id uuid, replayed boolean, in_progress boolean, result_snapshot jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role required' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.ack_receipt_ledger(site_id, request_key, payload_hash)
  VALUES (p_site_id, p_request_key, p_payload_hash)
  ON CONFLICT (site_id, request_key) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    UPDATE public.ack_receipt_ledger r
    SET apply_state = 'REGISTERED',
        payload_hash = p_payload_hash,
        result_snapshot = NULL,
        updated_at = now()
    WHERE r.site_id = p_site_id
      AND r.request_key = p_request_key
      AND r.apply_state = 'STALE'
    RETURNING r.id INTO v_id;
  END IF;

  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT v_id, false, true, NULL::jsonb;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.ack_receipt_ledger r
    WHERE r.site_id = p_site_id
      AND r.request_key = p_request_key
      AND r.payload_hash <> p_payload_hash
  ) THEN
    RAISE EXCEPTION 'ACK_PAYLOAD_HASH_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT id, true, (apply_state = 'REGISTERED') AS in_progress, result_snapshot
  FROM public.ack_receipt_ledger
  WHERE site_id = p_site_id AND request_key = p_request_key
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.sweep_stale_ack_receipts_v1(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_stale_ack_receipts_v1(integer, integer) TO service_role;
REVOKE ALL ON FUNCTION public.register_ack_receipt_v1(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_ack_receipt_v1(uuid, text, text) TO service_role;

COMMIT;

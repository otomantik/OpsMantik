-- OCI audit (L30): ACK receipt completion must not update rows across sites when
-- receipt_id alone is known — require matching site_id on the ledger row.

BEGIN;

DROP FUNCTION IF EXISTS public.complete_ack_receipt_v1(uuid, jsonb);

CREATE OR REPLACE FUNCTION public.complete_ack_receipt_v1(
  p_receipt_id uuid,
  p_site_id uuid,
  p_result_snapshot jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_updated integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role required' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.ack_receipt_ledger
  SET apply_state = 'APPLIED',
      result_snapshot = p_result_snapshot,
      updated_at = now()
  WHERE id = p_receipt_id
    AND site_id = p_site_id
    AND apply_state = 'REGISTERED';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_ack_receipt_v1(uuid, uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_ack_receipt_v1(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_ack_receipt_v1(uuid, uuid, jsonb) TO service_role;

COMMIT;

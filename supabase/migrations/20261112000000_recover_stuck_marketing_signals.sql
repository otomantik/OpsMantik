-- Stuck-Signal-Recoverer: Reset marketing_signals stuck in PROCESSING (or PENDING edge-case)
-- Action item from DONUSUM_SINYAL_DURUM_RAPORU. Script ack çağırmazsa PROCESSING kalır; bu RPC
-- 4 saatten eski satırları PENDING'e çekerek export'un tekrar seçebilmesini sağlar.
-- Uses lower(sys_period) as "last updated" (bitemporal); no schema change to marketing_signals.

BEGIN;

CREATE OR REPLACE FUNCTION public.recover_stuck_marketing_signals(p_min_age_minutes int DEFAULT 240)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff timestamptz := now() - (p_min_age_minutes || ' minutes')::interval;
  v_count int;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'recover_stuck_marketing_signals may only be called by service_role' USING ERRCODE = 'P0001';
  END IF;

  WITH updated AS (
    UPDATE public.marketing_signals
    SET dispatch_status = 'PENDING'
    WHERE dispatch_status = 'PROCESSING'
      AND lower(sys_period) < v_cutoff
    RETURNING id
  )
  SELECT count(*)::int INTO v_count FROM updated;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.recover_stuck_marketing_signals(int) IS
  'Stuck-Signal-Recoverer: PROCESSING signals older than p_min_age_minutes → PENDING (re-exportable). Uses lower(sys_period) as last-update. Default 240 min (4h). service_role only.';

GRANT EXECUTE ON FUNCTION public.recover_stuck_marketing_signals(int) TO service_role;

COMMIT;

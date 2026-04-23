BEGIN;

DROP TRIGGER IF EXISTS trg_marketing_signals_bitemporal ON public.marketing_signals;
DROP FUNCTION IF EXISTS public.marketing_signals_bitemporal_audit();
DROP FUNCTION IF EXISTS public.get_marketing_signals_as_of(uuid, timestamptz);
DROP TABLE IF EXISTS public.marketing_signals_history;

DROP INDEX IF EXISTS public.idx_marketing_signals_sys_period;
DROP INDEX IF EXISTS public.idx_marketing_signals_valid_period;
DROP INDEX IF EXISTS public.idx_marketing_signals_site_sys_period;

ALTER TABLE IF EXISTS public.marketing_signals
  DROP COLUMN IF EXISTS sys_period,
  DROP COLUMN IF EXISTS valid_period;

CREATE OR REPLACE FUNCTION public.recover_stuck_marketing_signals(p_min_age_minutes int DEFAULT 240)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role required' USING ERRCODE = 'P0001';
  END IF;

  WITH cutoff AS (
    SELECT now() - make_interval(mins => GREATEST(1, COALESCE(p_min_age_minutes, 240))) AS v_cutoff
  ), upd AS (
    UPDATE public.marketing_signals ms
    SET dispatch_status = 'PENDING',
        updated_at = now()
    FROM cutoff
    WHERE ms.dispatch_status = 'PROCESSING'
      AND ms.updated_at < cutoff.v_cutoff
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_count FROM upd;

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.reset_business_data_before_cutoff_v1(
  p_cutoff timestamptz,
  p_site_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ms integer := 0;
  v_queue integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role required' USING ERRCODE = 'P0001';
  END IF;

  IF to_regclass('public.marketing_signals') IS NOT NULL THEN
    DELETE FROM public.marketing_signals ms
    WHERE ms.created_at < p_cutoff
      AND (p_site_id IS NULL OR ms.site_id = p_site_id);
    GET DIAGNOSTICS v_ms = ROW_COUNT;
  END IF;

  IF to_regclass('public.offline_conversion_queue') IS NOT NULL THEN
    DELETE FROM public.offline_conversion_queue q
    WHERE q.created_at < p_cutoff
      AND (p_site_id IS NULL OR q.site_id = p_site_id);
    GET DIAGNOSTICS v_queue = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'marketing_signals_deleted', v_ms,
    'offline_conversion_queue_deleted', v_queue
  );
END;
$$;

COMMIT;

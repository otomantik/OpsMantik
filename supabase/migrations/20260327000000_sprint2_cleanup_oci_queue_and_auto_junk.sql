-- Sprint 2: OCI queue cleanup (COMPLETED/FATAL/FAILED older than N days) and 7-day auto-junk for stale intents.

-- 1) RPC: cleanup_oci_queue_batch — delete old terminal queue rows to prevent unbounded growth
CREATE OR REPLACE FUNCTION public.cleanup_oci_queue_batch(
  p_days_to_keep int DEFAULT 90,
  p_limit int DEFAULT 5000
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff timestamptz;
  v_deleted int;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'cleanup_oci_queue_batch may only be called by service_role' USING ERRCODE = 'P0001';
  END IF;

  v_cutoff := now() - (LEAST(GREATEST(p_days_to_keep, 1), 365) || ' days')::interval;

  WITH to_delete AS (
    SELECT id
    FROM public.offline_conversion_queue
    WHERE status IN ('COMPLETED', 'FATAL', 'FAILED')
      AND updated_at < v_cutoff
    ORDER BY updated_at ASC
    LIMIT LEAST(GREATEST(p_limit, 1), 10000)
  )
  DELETE FROM public.offline_conversion_queue
  WHERE id IN (SELECT id FROM to_delete);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION public.cleanup_oci_queue_batch(int, int) IS
  'Sprint 2: Delete terminal OCI queue rows (COMPLETED/FATAL/FAILED) older than p_days_to_keep. Batch size p_limit. Service_role only.';

GRANT EXECUTE ON FUNCTION public.cleanup_oci_queue_batch(int, int) TO service_role;


-- 2) RPC: cleanup_auto_junk_stale_intents — move intent/NULL leads older than N days to junk
CREATE OR REPLACE FUNCTION public.cleanup_auto_junk_stale_intents(
  p_days_old int DEFAULT 7,
  p_limit int DEFAULT 5000
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff timestamptz;
  v_updated int;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'cleanup_auto_junk_stale_intents may only be called by service_role' USING ERRCODE = 'P0001';
  END IF;

  v_cutoff := now() - (LEAST(GREATEST(p_days_old, 1), 365) || ' days')::interval;

  WITH to_junk AS (
    SELECT id
    FROM public.calls
    WHERE (status = 'intent' OR status IS NULL)
      AND created_at < v_cutoff
    ORDER BY created_at ASC
    LIMIT LEAST(GREATEST(p_limit, 1), 10000)
  )
  UPDATE public.calls
  SET status = 'junk', updated_at = now()
  WHERE id IN (SELECT id FROM to_junk);

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

COMMENT ON FUNCTION public.cleanup_auto_junk_stale_intents(int, int) IS
  'Sprint 2: Auto-junk leads with status intent/NULL older than p_days_old. Batch size p_limit. Service_role only.';

GRANT EXECUTE ON FUNCTION public.cleanup_auto_junk_stale_intents(int, int) TO service_role;

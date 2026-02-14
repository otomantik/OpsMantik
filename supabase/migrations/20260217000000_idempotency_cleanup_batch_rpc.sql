-- =============================================================================
-- Idempotency cleanup: batch delete RPC (max N rows per run, never current/previous month)
-- PR-1: Prevents timeout on large tables; safety = 90d cutoff + year_month guard.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.delete_expired_idempotency_batch(
  p_cutoff_iso TIMESTAMPTZ,
  p_batch_size INT DEFAULT 10000
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INT;
  v_keep_after_year_month TEXT;
BEGIN
  -- Never delete current or previous UTC month (dispute/invoice safety)
  v_keep_after_year_month := to_char(
    (date_trunc('month', (now() AT TIME ZONE 'UTC'))::date - interval '2 months'),
    'YYYY-MM'
  );

  WITH to_delete AS (
    SELECT site_id, idempotency_key
    FROM public.ingest_idempotency
    WHERE created_at < p_cutoff_iso
      AND year_month <= v_keep_after_year_month
    LIMIT p_batch_size
  )
  DELETE FROM public.ingest_idempotency
  WHERE (site_id, idempotency_key) IN (SELECT site_id, idempotency_key FROM to_delete);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION public.delete_expired_idempotency_batch(TIMESTAMPTZ, INT) IS
  'Revenue Kernel: Batch delete ingest_idempotency rows older than cutoff, never current/previous month. Returns deleted count. Call from cron; max p_batch_size per run.';

REVOKE ALL ON FUNCTION public.delete_expired_idempotency_batch(TIMESTAMPTZ, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_expired_idempotency_batch(TIMESTAMPTZ, INT) TO service_role;

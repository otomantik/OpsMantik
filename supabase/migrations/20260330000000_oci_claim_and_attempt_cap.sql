-- =============================================================================
-- OCI Deterministic Queue: claim with attempt_count increment + attempt-cap.
-- NON-NEGOTIABLE: attempt_count increments only on export claim (script path).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- claim_offline_conversion_rows_for_script_export
-- Called by GET /api/oci/google-ads-export when markAsExported=true.
-- Atomically: QUEUED/RETRY -> PROCESSING, claimed_at=now(), attempt_count+1.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_offline_conversion_rows_for_script_export(
  p_ids uuid[],
  p_site_id uuid
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated int;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'claim_offline_conversion_rows_for_script_export may only be called by service_role', ERRCODE = 'P0001';
  END IF;

  WITH updated AS (
    UPDATE public.offline_conversion_queue q
    SET
      status = 'PROCESSING',
      claimed_at = now(),
      updated_at = now(),
      attempt_count = attempt_count + 1
    WHERE q.id = ANY(p_ids)
      AND q.site_id = p_site_id
      AND q.status IN ('QUEUED', 'RETRY')
    RETURNING q.id
  )
  SELECT count(*)::int INTO v_updated FROM updated;

  RETURN v_updated;
END;
$$;

COMMENT ON FUNCTION public.claim_offline_conversion_rows_for_script_export(uuid[], uuid) IS
  'OCI script export claim: QUEUED/RETRY -> PROCESSING, claimed_at=now(), attempt_count+1. service_role only.';

GRANT EXECUTE ON FUNCTION public.claim_offline_conversion_rows_for_script_export(uuid[], uuid) TO service_role;

-- -----------------------------------------------------------------------------
-- oci_attempt_cap
-- Marks rows with attempt_count >= p_max_attempts as FAILED (terminal).
-- Optional min_age_minutes: only rows older than that (0 = no age filter).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.oci_attempt_cap(
  p_max_attempts int DEFAULT 5,
  p_min_age_minutes int DEFAULT 0
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated int;
  v_cutoff timestamptz;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'oci_attempt_cap may only be called by service_role', ERRCODE = 'P0001';
  END IF;

  v_cutoff := now() - (p_min_age_minutes || ' minutes')::interval;

  WITH updated AS (
    UPDATE public.offline_conversion_queue q
    SET
      status = 'FAILED',
      provider_error_code = 'MAX_ATTEMPTS',
      provider_error_category = 'PERMANENT',
      last_error = 'MAX_ATTEMPTS_EXCEEDED',
      updated_at = now()
    WHERE q.status IN ('QUEUED', 'RETRY', 'PROCESSING')
      AND q.attempt_count >= p_max_attempts
      AND (p_min_age_minutes = 0 OR q.updated_at < v_cutoff)
    RETURNING q.id
  )
  SELECT count(*)::int INTO v_updated FROM updated;

  RETURN v_updated;
END;
$$;

COMMENT ON FUNCTION public.oci_attempt_cap(int, int) IS
  'OCI attempt cap: rows with attempt_count >= p_max_attempts (and optionally older than p_min_age_minutes) -> FAILED with MAX_ATTEMPTS. service_role only.';

GRANT EXECUTE ON FUNCTION public.oci_attempt_cap(int, int) TO service_role;

COMMIT;

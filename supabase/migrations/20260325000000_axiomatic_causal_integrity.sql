-- =============================================================================
-- Axiomatic Causal Integrity: Restore Determinism
-- Reference: Causal Integrity Report, EXTINCTION, OMEGA Dossiers
--
-- 1. Phantom State: recover_stuck_ingest_fallback(15) — called from 5-min cron
-- 2. Halting: recover_attempt_count + QUARANTINE after 10 failed publishes
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) ingest_fallback_buffer: add recover_attempt_count
-- -----------------------------------------------------------------------------
ALTER TABLE public.ingest_fallback_buffer
  ADD COLUMN IF NOT EXISTS recover_attempt_count int NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.ingest_fallback_buffer.recover_attempt_count IS
  'Axiomatic: Bounded retries. After 10 failed QStash publish attempts -> QUARANTINE. System halts.';

-- -----------------------------------------------------------------------------
-- 2) ingest_fallback_status: add QUARANTINE
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'ingest_fallback_status' AND e.enumlabel = 'QUARANTINE'
  ) THEN
    ALTER TYPE public.ingest_fallback_status ADD VALUE 'QUARANTINE';
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

-- -----------------------------------------------------------------------------
-- 3) RPC: update_fallback_on_publish_failure — bounded retries, QUARANTINE at 10
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_fallback_on_publish_failure(p_rows jsonb)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r jsonb;
  v_id uuid;
  v_error_reason text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'update_fallback_on_publish_failure may only be called by service_role' USING ERRCODE = 'P0001';
  END IF;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RETURN 0;
  END IF;

  FOR r IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    v_id := (r->>'id')::uuid;
    v_error_reason := nullif(trim(r->>'error_reason'), '');

    UPDATE public.ingest_fallback_buffer
    SET
      recover_attempt_count = recover_attempt_count + 1,
      status = CASE
        WHEN recover_attempt_count + 1 >= 10 THEN 'QUARANTINE'::public.ingest_fallback_status
        ELSE 'PENDING'::public.ingest_fallback_status
      END,
      error_reason = v_error_reason,
      updated_at = now()
    WHERE id = v_id;
  END LOOP;

  RETURN (SELECT count(*)::int FROM jsonb_array_elements(p_rows) AS _);
END;
$$;

COMMENT ON FUNCTION public.update_fallback_on_publish_failure(jsonb) IS
  'Axiomatic: On publish failure, increment recover_attempt_count. At 10 -> QUARANTINE. System halts.';

GRANT EXECUTE ON FUNCTION public.update_fallback_on_publish_failure(jsonb) TO service_role;

-- -----------------------------------------------------------------------------
-- 4) get_and_claim_fallback_batch: exclude QUARANTINE (already PENDING only)
-- -----------------------------------------------------------------------------
-- No change needed: WHERE status = 'PENDING' excludes QUARANTINE.
-- Index on (status, created_at) WHERE status = 'PENDING' remains valid.

COMMIT;

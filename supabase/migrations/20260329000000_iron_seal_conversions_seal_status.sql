-- Iron Seal: conversions table — Seal enforcement.
-- No record is dispatched to Google Ads unless seal_status = 'sealed'.
-- Hard-block: get_pending_conversions_for_worker returns ONLY sealed rows.
-- Existing rows default to 'unsealed' (never dispatched until explicitly sealed).

BEGIN;

-- 1) Add seal_status column
ALTER TABLE public.conversions
  ADD COLUMN IF NOT EXISTS seal_status text DEFAULT 'unsealed';

COMMENT ON COLUMN public.conversions.seal_status IS
  'Iron Seal: Only rows with seal_status = ''sealed'' are dispatched. Default ''unsealed'' blocks bypass.';

-- 2) Backfill: existing rows stay unsealed (never dispatched)
UPDATE public.conversions
SET seal_status = 'unsealed'
WHERE seal_status IS NULL;

-- 3) Constraint: only valid values
ALTER TABLE public.conversions
  DROP CONSTRAINT IF EXISTS conversions_seal_status_check;

ALTER TABLE public.conversions
  ADD CONSTRAINT conversions_seal_status_check
  CHECK (seal_status IN ('unsealed', 'sealed'));

-- 4) Partial index: worker only scans sealed + pending rows
CREATE INDEX IF NOT EXISTS idx_conversions_sealed_pending
  ON public.conversions (next_retry_at, created_at)
  WHERE google_sent_at IS NULL
    AND google_action IS NOT NULL
    AND seal_status = 'sealed';

-- 5) Replace get_pending_conversions_for_worker — Seal filter (Iron Seal)
CREATE OR REPLACE FUNCTION public.get_pending_conversions_for_worker(
  p_batch_size   integer,
  p_current_time timestamptz DEFAULT now(),
  p_worker_id    text        DEFAULT 'worker'
)
RETURNS SETOF public.conversions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Iron Seal: ONLY sealed records are eligible for dispatch
  RETURN QUERY
  WITH picked AS (
    SELECT id
    FROM public.conversions
    WHERE google_sent_at  IS NULL
      AND google_action   IS NOT NULL
      AND seal_status     = 'sealed'  -- Hard-block: no unsealed data to Google
      AND next_retry_at   <= p_current_time
      AND (
        claimed_at IS NULL
        OR claimed_at < (p_current_time - INTERVAL '10 minutes')
      )
    ORDER BY created_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.conversions c
     SET claimed_at  = p_current_time,
         claimed_by  = p_worker_id,
         updated_at  = p_current_time
    FROM picked
   WHERE c.id = picked.id
  RETURNING c.*;
END;
$$;

COMMENT ON FUNCTION public.get_pending_conversions_for_worker(integer, timestamptz, text) IS
  'Iron Seal: Claims only seal_status=sealed rows. Unsealed rows are never dispatched.';

GRANT EXECUTE ON FUNCTION public.get_pending_conversions_for_worker(integer, timestamptz, text)
  TO service_role;

COMMIT;

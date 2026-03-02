-- PR-OCI-3: DB-level dedup for marketing_signals (V2/V3/V4 per call).
-- Ensures at most one row per (site_id, call_id, google_conversion_name) when call_id is set.
-- Concurrent seal actions (e.g. two operators clicking 60 on same call) result in one insert + one unique_violation (idempotent).
BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS idx_marketing_signals_site_call_gear
  ON public.marketing_signals (site_id, call_id, google_conversion_name)
  WHERE call_id IS NOT NULL;

COMMENT ON INDEX public.idx_marketing_signals_site_call_gear IS
  'One signal per (site, call, gear). Prevents duplicate V2/V3/V4 for same call. NULL call_id rows (legacy) are excluded.';

COMMIT;

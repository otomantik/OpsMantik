-- =============================================================================
-- Precision Logic: session_created_month zorunlu + partition pruning
-- COALESCE kaldırıldığında planner partition prune yapabilir.
-- =============================================================================

BEGIN;

-- 1) Backfill: NULL session_created_month'u doldur
UPDATE public.calls c
SET session_created_month = date_trunc('month', c.matched_at AT TIME ZONE 'utc')::date
WHERE c.session_created_month IS NULL
  AND c.matched_session_id IS NOT NULL
  AND c.matched_at IS NOT NULL;

-- 2) Trigger: matched_session_id varsa session_created_month otomatik set
CREATE OR REPLACE FUNCTION public.trg_calls_enforce_session_created_month()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.matched_session_id IS NOT NULL AND NEW.session_created_month IS NULL THEN
    NEW.session_created_month := date_trunc('month', (COALESCE(NEW.matched_at, now()) AT TIME ZONE 'utc'))::date;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS calls_enforce_session_created_month ON public.calls;
CREATE TRIGGER calls_enforce_session_created_month
  BEFORE INSERT OR UPDATE OF matched_session_id, matched_at, session_created_month
  ON public.calls
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_calls_enforce_session_created_month();

COMMENT ON FUNCTION public.trg_calls_enforce_session_created_month() IS
  'Ensures session_created_month is set when matched_session_id present. Enables partition pruning on sessions JOIN.';

-- 3) Covering indexes (Index-Only Scan)
CREATE INDEX IF NOT EXISTS idx_calls_site_status_created_covering
  ON public.calls (site_id, status, created_at DESC)
  INCLUDE (matched_session_id, session_created_month, lead_score, intent_action);

CREATE INDEX IF NOT EXISTS idx_ocq_site_status_created_covering
  ON public.offline_conversion_queue (site_id, status, created_at DESC)
  INCLUDE (call_id, gclid, conversion_time, value_cents)
  WHERE status = 'COMPLETED';

-- marketing_signals: mevcut idx_marketing_signals_pending var; covering INCLUDE eklenebilir
CREATE INDEX IF NOT EXISTS idx_marketing_signals_site_pending_covering
  ON public.marketing_signals (site_id, created_at)
  INCLUDE (call_id, signal_type, google_conversion_name, dispatch_status)
  WHERE dispatch_status = 'PENDING';

COMMIT;

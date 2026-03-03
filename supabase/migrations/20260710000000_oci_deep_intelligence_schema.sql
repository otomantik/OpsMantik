-- OCI Deep Intelligence — Schema additions (discovery, recovery, value floor)
-- Plan: Identity Stitcher, Self-Healing Pulse, Value Floor
-- =============================================================================

BEGIN;

-- 1. offline_conversion_queue: discovery_method, discovery_confidence (audit trail)
ALTER TABLE public.offline_conversion_queue
  ADD COLUMN IF NOT EXISTS discovery_method text,
  ADD COLUMN IF NOT EXISTS discovery_confidence numeric(3,2);

COMMENT ON COLUMN public.offline_conversion_queue.discovery_method IS
  'How GCLID was found: DIRECT, PHONE_STITCH, FINGERPRINT_STITCH';

COMMENT ON COLUMN public.offline_conversion_queue.discovery_confidence IS
  '0-1 confidence for stitched discovery. 1.0 for DIRECT.';

-- 2. marketing_signals: recovery for Self-Healing Pulse
ALTER TABLE public.marketing_signals
  ADD COLUMN IF NOT EXISTS recovery_attempt_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_recovery_attempt_at timestamptz;

COMMENT ON COLUMN public.marketing_signals.recovery_attempt_count IS
  'Self-Healing: number of recovery attempts. Max 3.';

COMMENT ON COLUMN public.marketing_signals.last_recovery_attempt_at IS
  'Self-Healing: last retry timestamp. Gates next attempt via exponential backoff.';

-- 3. marketing_signals: recovered click ids (Identity Stitcher writes here)
ALTER TABLE public.marketing_signals
  ADD COLUMN IF NOT EXISTS gclid text,
  ADD COLUMN IF NOT EXISTS wbraid text,
  ADD COLUMN IF NOT EXISTS gbraid text;

COMMENT ON COLUMN public.marketing_signals.gclid IS
  'Recovered GCLID from Identity Stitcher. Export uses this if set.';

-- 4. Append-only trigger: allow gclid/wbraid/gbraid updates (Self-Healing recovery)
CREATE OR REPLACE FUNCTION public._marketing_signals_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'marketing_signals: DELETE not allowed (append-only).';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.site_id IS DISTINCT FROM OLD.site_id
       OR NEW.signal_type IS DISTINCT FROM OLD.signal_type
       OR NEW.google_conversion_name IS DISTINCT FROM OLD.google_conversion_name THEN
      RAISE EXCEPTION 'marketing_signals: signal content immutable.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- 5. Partial index for Self-Healing: PENDING signals by dispatch_status, created_at
CREATE INDEX IF NOT EXISTS idx_marketing_signals_pending_recovery
  ON public.marketing_signals (dispatch_status, created_at)
  WHERE dispatch_status = 'PENDING';

COMMENT ON INDEX public.idx_marketing_signals_pending_recovery IS
  'Self-Healing Pulse: efficient scan of PENDING signals for recovery.';

COMMIT;

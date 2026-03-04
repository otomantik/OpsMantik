-- OCI-9B: Add SKIPPED_NO_CLICK_ID to marketing_signals.dispatch_status.
-- Signals without gclid/wbraid/gbraid are explicitly marked instead of staying PENDING forever.
BEGIN;

ALTER TABLE public.marketing_signals DROP CONSTRAINT IF EXISTS marketing_signals_dispatch_status_check;
ALTER TABLE public.marketing_signals
  ADD CONSTRAINT marketing_signals_dispatch_status_check
  CHECK (dispatch_status IN ('PENDING', 'SENT', 'FAILED', 'SKIPPED_NO_CLICK_ID'));

COMMENT ON CONSTRAINT marketing_signals_dispatch_status_check ON public.marketing_signals IS
  'OCI-9: SKIPPED_NO_CLICK_ID = signal has no click id; export marks instead of leaving PENDING.';

COMMIT;

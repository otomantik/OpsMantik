-- Phase 20: Add STALLED_FOR_HUMAN_AUDIT for Vacuum job

ALTER TABLE public.marketing_signals DROP CONSTRAINT IF EXISTS marketing_signals_dispatch_status_check;
ALTER TABLE public.marketing_signals
  ADD CONSTRAINT marketing_signals_dispatch_status_check
  CHECK (dispatch_status IN (
    'PENDING', 'PROCESSING', 'SENT', 'FAILED', 'DEAD_LETTER_QUARANTINE',
    'SKIPPED_NO_CLICK_ID', 'STALLED_FOR_HUMAN_AUDIT'
  ));

COMMENT ON CONSTRAINT marketing_signals_dispatch_status_check ON public.marketing_signals IS
  'Phase 20: STALLED_FOR_HUMAN_AUDIT = PENDING > 15m with no recovery path';

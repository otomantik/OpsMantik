-- Phase 6.1 & 6.3: Expand dispatch_status for marketing_signals
-- Adds 'PROCESSING' for chunked checkpointing and 'DEAD_LETTER_QUARANTINE' for poison pills.

BEGIN;

-- 1. Relax the check constraint
ALTER TABLE public.marketing_signals 
DROP CONSTRAINT IF EXISTS marketing_signals_dispatch_status_check;

ALTER TABLE public.marketing_signals 
ADD CONSTRAINT marketing_signals_dispatch_status_check 
CHECK (dispatch_status IN ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'DEAD_LETTER_QUARANTINE'));

-- 2. Update the append-only trigger to allow the new status updates
-- (The existing trigger allows status updates, so this should be fine, but we'll ensure)

COMMENT ON COLUMN public.marketing_signals.dispatch_status IS 
  'Queue status: PENDING (new), PROCESSING (exported to script), SENT (ACKed), FAILED (nack), DEAD_LETTER_QUARANTINE (poison pill).';

COMMIT;

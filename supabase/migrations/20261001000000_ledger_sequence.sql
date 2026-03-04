-- Phase 6.4: Append-Only Ledger Sequence
-- Allows multiple signals per (site, call, gear) via incrementing adjustment_sequence.
-- Maintains strict idempotency for each specific iteration.

BEGIN;

-- 1. Add the sequence column
ALTER TABLE public.marketing_signals 
ADD COLUMN IF NOT EXISTS adjustment_sequence INT DEFAULT 0 NOT NULL;

-- 2. Drop the old unique index
DROP INDEX IF EXISTS public.idx_marketing_signals_site_call_gear;

-- 3. Create the new strict unique constraint
-- We use a unique index where call_id is not null.
CREATE UNIQUE INDEX IF NOT EXISTS idx_marketing_signals_site_call_gear_seq
  ON public.marketing_signals (site_id, call_id, google_conversion_name, adjustment_sequence)
  WHERE call_id IS NOT NULL;

COMMENT ON INDEX public.idx_marketing_signals_site_call_gear_seq IS
  'Strict Ledger Sequence: One signal per (site, call, gear, sequence). Enables immutable adjustments.';

COMMIT;

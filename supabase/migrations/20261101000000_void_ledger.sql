-- Phase 8.1: The Merkle Tree Ledger expansion
-- Adds hash chaining to marketing_signals to detect tampering.

BEGIN;

ALTER TABLE public.marketing_signals 
ADD COLUMN IF NOT EXISTS previous_hash TEXT,
ADD COLUMN IF NOT EXISTS current_hash TEXT;

-- Index for temporal consistency and chain resolution
CREATE INDEX IF NOT EXISTS idx_marketing_signals_chain 
ON public.marketing_signals (site_id, call_id, google_conversion_name, adjustment_sequence);

COMMENT ON COLUMN public.marketing_signals.previous_hash IS 'SHA-256 hash of the previous adjustment in the sequence.';
COMMENT ON COLUMN public.marketing_signals.current_hash IS 'SHA-256 hash of (call_id + sequence + value_cents + previous_hash + salt).';

COMMIT;

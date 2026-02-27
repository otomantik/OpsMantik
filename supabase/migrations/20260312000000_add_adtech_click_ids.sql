-- Migration: Add AdTech Click IDs and source_type to calls table
-- Also enforces deduplication in the offline_conversion_queue

ALTER TABLE public.calls
ADD COLUMN IF NOT EXISTS gclid TEXT,
ADD COLUMN IF NOT EXISTS wbraid TEXT,
ADD COLUMN IF NOT EXISTS gbraid TEXT,
ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'organic';

-- Add comments for clarity
COMMENT ON COLUMN public.calls.gclid IS 'Universal Google Click ID (PPC).';
COMMENT ON COLUMN public.calls.wbraid IS 'iOS 14+ Web Click ID (Aggregated).';
COMMENT ON COLUMN public.calls.gbraid IS 'iOS 14+ App/Web Click ID (Aggregated).';
COMMENT ON COLUMN public.calls.source_type IS 'Lead origin: organic or paid.';

-- Index for OCI coverage and search
CREATE INDEX IF NOT EXISTS idx_calls_click_coverage 
ON public.calls (site_id, gclid, wbraid, gbraid);

-- Enforce deduplication in offline_conversion_queue
-- This prevents the same call from being enqueued twice for the same conversion action.
ALTER TABLE public.offline_conversion_queue
DROP CONSTRAINT IF EXISTS unique_call_conversion_action;

-- Note: In our current schema, conversion_action is often mapped to 'action' or a hardcoded value.
-- We ensure uniqueness per call_id and provider_key at minimum.
ALTER TABLE public.offline_conversion_queue
ADD CONSTRAINT unique_call_conversion_action UNIQUE (call_id, provider_key);

-- Add source_type index for high-level reporting
CREATE INDEX IF NOT EXISTS idx_calls_source_type ON public.calls(source_type);

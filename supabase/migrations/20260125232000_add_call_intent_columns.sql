-- Migration: Add Call Intent Queue (CIQ) columns to calls table
-- Date: 2026-01-25
-- Purpose: Support soft call intents from phone/whatsapp clicks

-- Update status column to include 'intent' and 'confirmed' and 'real'
ALTER TABLE public.calls
DROP CONSTRAINT IF EXISTS calls_status_check;

ALTER TABLE public.calls
ADD CONSTRAINT calls_status_check 
CHECK (status IN ('intent', 'confirmed', 'junk', 'qualified', 'real') OR status IS NULL);

-- Set default status to 'intent' for new rows (existing rows remain NULL or 'qualified'/'junk')
ALTER TABLE public.calls
ALTER COLUMN status SET DEFAULT 'intent';

-- Add source column (click, api, manual)
ALTER TABLE public.calls
ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'click';

-- Add confirmed_at timestamp
ALTER TABLE public.calls
ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;

-- Add confirmed_by (user who confirmed the intent)
ALTER TABLE public.calls
ADD COLUMN IF NOT EXISTS confirmed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Add note column for manual notes
ALTER TABLE public.calls
ADD COLUMN IF NOT EXISTS note TEXT;

-- Add index for source filtering
CREATE INDEX IF NOT EXISTS idx_calls_source 
ON public.calls(source)
WHERE source IS NOT NULL;

-- Add index for status filtering (intent calls)
CREATE INDEX IF NOT EXISTS idx_calls_status_intent 
ON public.calls(status)
WHERE status = 'intent';

-- Add index for confirmed_at
CREATE INDEX IF NOT EXISTS idx_calls_confirmed_at 
ON public.calls(confirmed_at)
WHERE confirmed_at IS NOT NULL;

-- Note: Dedupe is handled at application level in /api/sync route
-- Checks for existing intent within 60 seconds for same session+source
-- Index for query performance (not for dedupe constraint)
CREATE INDEX IF NOT EXISTS idx_calls_dedupe_intent 
ON public.calls(site_id, matched_session_id, source, created_at)
WHERE status = 'intent';

-- Add comments
COMMENT ON COLUMN public.calls.status IS 'Call status: intent (soft click), confirmed (intent confirmed), junk, qualified, real (actual call)';
COMMENT ON COLUMN public.calls.source IS 'Source of call: click (phone/whatsapp click), api (call-event API), manual';
COMMENT ON COLUMN public.calls.confirmed_at IS 'Timestamp when intent was confirmed by user';
COMMENT ON COLUMN public.calls.confirmed_by IS 'User ID who confirmed the intent';
COMMENT ON COLUMN public.calls.note IS 'Manual note for the call';

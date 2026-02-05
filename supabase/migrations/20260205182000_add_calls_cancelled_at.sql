-- Add cancelled_at column required for database-backed kill feed + cancel flow
-- This was referenced by get_kill_feed_v1 and the API cancel action.

ALTER TABLE public.calls
ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;


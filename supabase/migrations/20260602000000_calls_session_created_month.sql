-- =============================================================================
-- OCI Performance: Add session_created_month to calls for partition pruning.
-- Enables get_call_session_for_oci to use s.created_month = c.session_created_month
-- instead of scanning all sessions partitions.
-- =============================================================================

BEGIN;

ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS session_created_month DATE;

COMMENT ON COLUMN public.calls.session_created_month IS
  'Session partition (sessions.created_month). Set from call-event payload for OCI RPC partition pruning.';

-- Backfill: derive from matched_at for existing calls (best-effort)
UPDATE public.calls c
SET session_created_month = date_trunc('month', c.matched_at AT TIME ZONE 'utc')::date
WHERE c.session_created_month IS NULL
  AND c.matched_session_id IS NOT NULL
  AND c.matched_at IS NOT NULL;

COMMIT;

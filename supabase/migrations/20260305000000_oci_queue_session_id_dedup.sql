-- =============================================================================
-- OCI duplicate guard: one pending conversion per session (per site).
-- Add session_id to offline_conversion_queue; backfill from calls; enforce
-- at most one row per (site_id, session_id) in QUEUED/RETRY/PROCESSING.
-- =============================================================================

BEGIN;

-- Add session_id (nullable: sale-originated rows have no session)
ALTER TABLE public.offline_conversion_queue
  ADD COLUMN IF NOT EXISTS session_id uuid;

COMMENT ON COLUMN public.offline_conversion_queue.session_id IS
  'matched_session_id from the call (call-originated rows). Used for 1 conversion per session deduplication.';

-- Backfill from calls where call_id is set
UPDATE public.offline_conversion_queue oq
SET session_id = c.matched_session_id
FROM public.calls c
WHERE oq.call_id = c.id
  AND oq.site_id = c.site_id
  AND oq.session_id IS NULL
  AND c.matched_session_id IS NOT NULL;

-- Partial unique: at most one pending row per (site_id, session_id) when session_id is set
CREATE UNIQUE INDEX IF NOT EXISTS idx_offline_conversion_queue_site_session_pending
  ON public.offline_conversion_queue (site_id, session_id)
  WHERE status IN ('QUEUED', 'RETRY', 'PROCESSING')
    AND session_id IS NOT NULL;

COMMENT ON INDEX public.idx_offline_conversion_queue_site_session_pending IS
  'OCI dedupe: one pending conversion per session per site.';

COMMIT;

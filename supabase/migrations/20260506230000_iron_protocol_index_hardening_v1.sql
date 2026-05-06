-- ⚡ Iron Protocol: Index Hardening & Performance Optimization
-- Created: 2026-05-06
-- Scope: OCI Pipeline Throughput, Attribution Latency, Dashboard Snappiness

BEGIN;

--------------------------------------------------------------------------------
-- 1. OCI PIPELINE: Snapshot & Transition Performance
--------------------------------------------------------------------------------

-- Optimize DISTINCT ON (queue_id) for snapshot apply logic.
-- Adding id DESC makes it a perfect covering index for the worker's latest status query.
CREATE INDEX IF NOT EXISTS idx_oci_queue_transitions_snapshot_covering
ON public.oci_queue_transitions (queue_id, created_at DESC, id DESC);


--------------------------------------------------------------------------------
-- 2. ATTRIBUTION: Faster Stitching & Session Lookups
--------------------------------------------------------------------------------

-- Critical for GCLID/WBRAID/GBRAID stitching via matched_session_id.
CREATE INDEX IF NOT EXISTS idx_calls_matched_session_id 
ON public.calls (matched_session_id) 
WHERE matched_session_id IS NOT NULL;

-- Faster dashboard filtering and worker status scans.
CREATE INDEX IF NOT EXISTS idx_calls_site_status_created 
ON public.calls (site_id, status, created_at DESC);


--------------------------------------------------------------------------------
-- 3. SIGNALING: Faster Reversals & Junk Processing
--------------------------------------------------------------------------------

-- Direct lookup by call_id for Junk Reversal logic in process-outbox.
CREATE INDEX IF NOT EXISTS idx_marketing_signals_call_id 
ON public.marketing_signals (call_id) 
WHERE call_id IS NOT NULL;


--------------------------------------------------------------------------------
-- 4. HYGIENE: Efficient Pruning Scans
--------------------------------------------------------------------------------

-- Speeds up the cleanup of old outbox events.
CREATE INDEX IF NOT EXISTS idx_outbox_events_cleanup 
ON public.outbox_events (status, created_at) 
WHERE status = 'PROCESSED';


--------------------------------------------------------------------------------
-- 5. SESSIONS: High-Speed Active Session Filtering
--------------------------------------------------------------------------------

-- Essential for tracker/ingest layer when searching for active attribution windows.
CREATE INDEX IF NOT EXISTS idx_sessions_site_active_created
ON public.sessions (site_id, created_at DESC);

COMMIT;

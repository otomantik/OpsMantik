-- Migration: RPC Performance Indexes (Optional Optimization)
-- Date: 2026-01-28
-- Purpose: Add composite indexes for faster date range queries in dashboard RPCs
-- Note: These are optional optimizations. RPCs work without them but may be slower on large datasets.

-- ============================================
-- Index 1: sessions - Composite for date range queries
-- ============================================
-- Speeds up: get_dashboard_stats, get_dashboard_timeline, get_dashboard_breakdown
CREATE INDEX IF NOT EXISTS idx_sessions_site_month_date 
ON public.sessions(site_id, created_month, created_at);

COMMENT ON INDEX idx_sessions_site_month_date IS 'Composite index for dashboard RPCs: site_id + partition + date range';

-- ============================================
-- Index 2: calls - Composite for date range queries
-- ============================================
-- Speeds up: get_dashboard_stats, get_dashboard_timeline, get_dashboard_intents
CREATE INDEX IF NOT EXISTS idx_calls_site_date 
ON public.calls(site_id, created_at);

COMMENT ON INDEX idx_calls_site_date IS 'Composite index for dashboard RPCs: site_id + date range';

-- ============================================
-- Index 3: events - Partial index for conversion queries
-- ============================================
-- Speeds up: get_dashboard_intents (conversion events branch)
CREATE INDEX IF NOT EXISTS idx_events_month_category 
ON public.events(session_month, event_category) 
WHERE event_category = 'conversion';

COMMENT ON INDEX idx_events_month_category IS 'Partial index for conversion events in get_dashboard_intents';

-- ============================================
-- Index 4: events - Composite for session join + date range
-- ============================================
-- Speeds up: get_dashboard_stats, get_dashboard_timeline (events branch)
CREATE INDEX IF NOT EXISTS idx_events_session_month_date 
ON public.events(session_id, session_month, created_at);

COMMENT ON INDEX idx_events_session_month_date IS 'Composite index for events with session join + date range';

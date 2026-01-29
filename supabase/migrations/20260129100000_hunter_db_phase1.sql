-- =============================================================================
-- EXECUTION PHASE 1: SECTOR ALPHA (Hunter Database Upgrade)
-- Run in Supabase SQL Editor in order, or apply via: supabase db push
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1.1 ENABLE INTELLIGENCE (AI Columns)
-- Memory slots for the "Brain" to write into later.
-- -----------------------------------------------------------------------------
ALTER TABLE public.sessions
ADD COLUMN IF NOT EXISTS ai_score INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS ai_summary TEXT,
ADD COLUMN IF NOT EXISTS ai_tags TEXT[],
ADD COLUMN IF NOT EXISTS user_journey_path TEXT;

COMMENT ON COLUMN public.sessions.ai_score IS 'AI-derived lead/quality score (0-100).';
COMMENT ON COLUMN public.sessions.ai_summary IS 'AI-generated session summary.';
COMMENT ON COLUMN public.sessions.ai_tags IS 'AI tags e.g. high-intent, plumber.';
COMMENT ON COLUMN public.sessions.user_journey_path IS 'Simplified path e.g. Home > Service > Contact.';

-- Performance: site_id on EVENTS for Realtime filtering (nullable for existing rows)
ALTER TABLE public.events
ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES public.sites(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_events_site_id ON public.events(site_id);

COMMENT ON COLUMN public.events.site_id IS 'Denormalized for fast Realtime filter; API must populate on insert.';

-- -----------------------------------------------------------------------------
-- 1.2 CONSTRUCT THE LEDGER (Deduplication / Zero-Loss)
-- Client retries; DB answers: "I already have this."
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.processed_signals (
    event_id UUID NOT NULL PRIMARY KEY,
    received_at TIMESTAMPTZ DEFAULT NOW(),
    site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'processed'
);

CREATE INDEX IF NOT EXISTS idx_processed_signals_lookup ON public.processed_signals(event_id);
CREATE INDEX IF NOT EXISTS idx_processed_signals_site_id ON public.processed_signals(site_id);

COMMENT ON TABLE public.processed_signals IS 'Ledger for idempotent event ingestion; prevents duplicate processing on retry.';

-- API-only table: RLS on, no policies => only service_role (API) can access
ALTER TABLE public.processed_signals ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 1.3 DEFUSE THE TIME-BOMB (Auto-Partitioning)
-- Creates next month partitions so Feb 1st writes never fail.
-- Enable pg_cron in Supabase: Database > Extensions > pg_cron (if available).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_next_month_partitions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    next_month DATE := DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month';
    partition_name_sessions TEXT;
    partition_name_events TEXT;
    start_date TEXT;
    end_date TEXT;
BEGIN
    partition_name_sessions := 'sessions_' || TO_CHAR(next_month, 'YYYY_MM');
    partition_name_events := 'events_' || TO_CHAR(next_month, 'YYYY_MM');
    start_date := TO_CHAR(next_month, 'YYYY-MM-DD');
    end_date := TO_CHAR(next_month + INTERVAL '1 month', 'YYYY-MM-DD');

    -- Create Sessions partition if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = partition_name_sessions
    ) THEN
        EXECUTE format(
            'CREATE TABLE public.%I PARTITION OF public.sessions FOR VALUES FROM (%L) TO (%L)',
            partition_name_sessions, start_date, end_date
        );
        RAISE NOTICE 'Created partition: %', partition_name_sessions;
    END IF;

    -- Create Events partition if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = partition_name_events
    ) THEN
        EXECUTE format(
            'CREATE TABLE public.%I PARTITION OF public.events FOR VALUES FROM (%L) TO (%L)',
            partition_name_events, start_date, end_date
        );
        RAISE NOTICE 'Created partition: %', partition_name_events;
    END IF;
END;
$$;

COMMENT ON FUNCTION public.create_next_month_partitions() IS 'Creates sessions_YYYY_MM and events_YYYY_MM for next month; run daily or monthly.';

-- Schedule via pg_cron if extension is enabled (safe to run; skips if unavailable)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.schedule(
            'maintain-partitions',
            '0 3 * * *',
            'SELECT public.create_next_month_partitions()'
        );
        RAISE NOTICE 'pg_cron: scheduled maintain-partitions daily at 03:00.';
    ELSE
        RAISE NOTICE 'pg_cron not enabled. Run create_next_month_partitions() manually or via a Scheduled Edge Function (e.g. 1st of month).';
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'pg_cron schedule skipped: %. Run create_next_month_partitions() manually or via Edge Function.', SQLERRM;
END;
$$;

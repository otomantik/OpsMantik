-- =============================================================================
-- Ingest publish failures: observability for QStash publish errors (silent data loss risk)
-- When /api/sync returns 200 but QStash publish failed, we record here + log.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.ingest_publish_failures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_public_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    error_code TEXT NOT NULL,
    error_message_short TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_ingest_publish_failures_created_at
    ON public.ingest_publish_failures(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingest_publish_failures_site_created
    ON public.ingest_publish_failures(site_public_id, created_at DESC);

COMMENT ON TABLE public.ingest_publish_failures IS
    'Best-effort log of QStash publish failures from /api/sync. Used for observability; insert must not throw.';

ALTER TABLE public.ingest_publish_failures ENABLE ROW LEVEL SECURITY;

GRANT INSERT, SELECT ON public.ingest_publish_failures TO service_role;

-- RPC: last 1h failures, optionally filtered by site. For admin/dashboards.
CREATE OR REPLACE FUNCTION public.get_ingest_publish_failures_last_1h(p_site_public_id TEXT DEFAULT NULL)
RETURNS TABLE (
    id UUID,
    site_public_id TEXT,
    created_at TIMESTAMPTZ,
    error_code TEXT,
    error_message_short TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT f.id, f.site_public_id, f.created_at, f.error_code, f.error_message_short
    FROM public.ingest_publish_failures f
    WHERE f.created_at >= NOW() - INTERVAL '1 hour'
      AND (p_site_public_id IS NULL OR f.site_public_id = p_site_public_id)
    ORDER BY f.created_at DESC;
$$;

COMMENT ON FUNCTION public.get_ingest_publish_failures_last_1h(TEXT) IS
    'Returns ingest publish failures in the last hour. Pass site_public_id to filter by site, or NULL for all.';

GRANT EXECUTE ON FUNCTION public.get_ingest_publish_failures_last_1h(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_ingest_publish_failures_last_1h(TEXT) TO authenticated;

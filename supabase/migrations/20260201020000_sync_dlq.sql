-- =============================================================================
-- SYNC DLQ: Dead-letter queue for non-retryable worker failures
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.sync_dlq (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    site_id UUID NULL REFERENCES public.sites(id) ON DELETE SET NULL,
    qstash_message_id TEXT NULL,
    dedup_event_id UUID NULL,
    stage TEXT NULL,
    error TEXT NULL,
    payload JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sync_dlq_received_at ON public.sync_dlq(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_dlq_site_id ON public.sync_dlq(site_id);
CREATE INDEX IF NOT EXISTS idx_sync_dlq_qstash_message_id ON public.sync_dlq(qstash_message_id);
CREATE INDEX IF NOT EXISTS idx_sync_dlq_dedup_event_id ON public.sync_dlq(dedup_event_id);

COMMENT ON TABLE public.sync_dlq IS 'Dead-letter queue for sync worker. Stores non-retryable payloads + error details for manual replay/audit.';

-- API-only table: RLS on, no policies => only service_role (API) can access
ALTER TABLE public.sync_dlq ENABLE ROW LEVEL SECURITY;


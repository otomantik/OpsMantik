-- =============================================================================
-- DLQ replay audit: who replayed, when, replay_count after
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.sync_dlq_replay_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dlq_id UUID NOT NULL REFERENCES public.sync_dlq(id) ON DELETE CASCADE,
    replayed_by_user_id UUID NULL,
    replayed_by_email TEXT NULL,
    replayed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    replay_count_after INTEGER NOT NULL,
    error_if_failed TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_sync_dlq_replay_audit_dlq_id ON public.sync_dlq_replay_audit(dlq_id);
CREATE INDEX IF NOT EXISTS idx_sync_dlq_replay_audit_replayed_at ON public.sync_dlq_replay_audit(replayed_at DESC);

COMMENT ON TABLE public.sync_dlq_replay_audit IS 'Audit trail for DLQ replay: who replayed which dlq, when, replay_count after.';

ALTER TABLE public.sync_dlq_replay_audit ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- SYNC DLQ REPLAY: add replay metadata columns
-- =============================================================================

ALTER TABLE public.sync_dlq
ADD COLUMN IF NOT EXISTS replay_count INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_replay_at TIMESTAMPTZ NULL,
ADD COLUMN IF NOT EXISTS last_replay_error TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_sync_dlq_last_replay_at ON public.sync_dlq(last_replay_at DESC);


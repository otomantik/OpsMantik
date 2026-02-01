-- =============================================================================
-- Events idempotency: optional ingest_dedup_id for DB-level dedup (defense in depth)
-- Worker passes dedup_event_id; duplicate insert → unique violation → no double count
-- =============================================================================

ALTER TABLE public.events
ADD COLUMN IF NOT EXISTS ingest_dedup_id UUID NULL;

-- Partitioned table: UNIQUE must include partition key (session_month)
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_ingest_dedup_id
ON public.events (session_month, ingest_dedup_id)
WHERE ingest_dedup_id IS NOT NULL;

COMMENT ON COLUMN public.events.ingest_dedup_id IS 'Idempotency key from sync worker (processed_signals ledger); prevents duplicate event insert on retry.';

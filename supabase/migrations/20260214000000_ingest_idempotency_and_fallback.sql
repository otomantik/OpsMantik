-- =============================================================================
-- Enterprise ingestion: Idempotency (gatekeeper) + Fallback buffer (safety net)
-- Part A: ingest_idempotency — prevent double-processing at API edge (no client IDs)
-- Part B: ingest_fallback_buffer — zero data loss when QStash is down
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Part A: ingest_idempotency
-- Lightweight table: server-side key = SHA256(site_id + event_name + url + session_fingerprint + time_bucket_5s)
-- UNIQUE(site_id, idempotency_key); RLS for tenant isolation; service_role for API/cron.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ingest_idempotency (
    site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
    idempotency_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (site_id, idempotency_key)
);

-- TTL cleanup: cron can DELETE WHERE expires_at < NOW()
CREATE INDEX IF NOT EXISTS idx_ingest_idempotency_expires_at
    ON public.ingest_idempotency(expires_at);

COMMENT ON TABLE public.ingest_idempotency IS
    'API-edge idempotency: deterministic key per (site, event, url, fingerprint, 5s window). Prevents duplicate processing on client retries.';

ALTER TABLE public.ingest_idempotency ENABLE ROW LEVEL SECURITY;

-- Tenant isolation: anon/authenticated cannot access; service_role (API/cron) can.
-- No policies = no direct access for anon/authenticated; grant to service_role only.
GRANT INSERT, SELECT ON public.ingest_idempotency TO service_role;

-- Optional: allow service_role to delete expired rows (cleanup job)
GRANT DELETE ON public.ingest_idempotency TO service_role;


-- -----------------------------------------------------------------------------
-- Part B: ingest_fallback_buffer
-- When QStash publish fails, we store the full worker payload here and return 200 (degraded).
-- Recovery cron processes PENDING rows with FOR UPDATE SKIP LOCKED.
-- -----------------------------------------------------------------------------

CREATE TYPE public.ingest_fallback_status AS ENUM ('PENDING', 'PROCESSING', 'RECOVERED', 'FAILED');

CREATE TABLE IF NOT EXISTS public.ingest_fallback_buffer (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
    payload JSONB NOT NULL,
    error_reason TEXT NULL,
    status public.ingest_fallback_status NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- FIFO processing: recovery worker selects ORDER BY created_at LIMIT N
CREATE INDEX IF NOT EXISTS idx_ingest_fallback_buffer_status_created
    ON public.ingest_fallback_buffer(status, created_at)
    WHERE status = 'PENDING';

COMMENT ON TABLE public.ingest_fallback_buffer IS
    'Safety net when QStash is down: full worker payload stored; recovery cron retries publish.';

ALTER TABLE public.ingest_fallback_buffer ENABLE ROW LEVEL SECURITY;

GRANT INSERT, SELECT, UPDATE, DELETE ON public.ingest_fallback_buffer TO service_role;


-- -----------------------------------------------------------------------------
-- Recovery: claim a batch of PENDING rows (concurrency-safe: FOR UPDATE SKIP LOCKED)
-- Marks them PROCESSING so other workers skip them; caller then retries publish and sets RECOVERED or back to PENDING.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_and_claim_fallback_batch(p_limit INT DEFAULT 100)
RETURNS TABLE (
    id UUID,
    site_id UUID,
    payload JSONB,
    error_reason TEXT,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    WITH locked AS (
        SELECT b.id
        FROM public.ingest_fallback_buffer b
        WHERE b.status = 'PENDING'
        ORDER BY b.created_at
        LIMIT p_limit
        FOR UPDATE OF b SKIP LOCKED
    )
    UPDATE public.ingest_fallback_buffer b
    SET status = 'PROCESSING'
    FROM locked
    WHERE b.id = locked.id
    RETURNING b.id, b.site_id, b.payload, b.error_reason, b.created_at;
END;
$$;

COMMENT ON FUNCTION public.get_and_claim_fallback_batch(INT) IS
    'Recovery worker: claim PENDING rows for retry. Concurrency-safe via FOR UPDATE SKIP LOCKED.';

GRANT EXECUTE ON FUNCTION public.get_and_claim_fallback_batch(INT) TO service_role;


-- -----------------------------------------------------------------------------
-- RLS: No policies for anon/authenticated => only service_role (internal workers) can access.
-- Both tables are API-only; tenant isolation is by site_id in row.
-- =============================================================================

-- =============================================================================
-- Patch OCI Recovery Ghosting: Respect Explicit Routing partitioning.
-- The recovery cron must ignore sites where OCI is handled by Scripts.
-- =============================================================================

BEGIN;

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
        JOIN public.sites s ON s.id = b.site_id
        WHERE b.status = 'PENDING'
          AND s.oci_sync_method = 'api'
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
    'Recovery worker (HARDENED): claim PENDING rows where oci_sync_method = api. Respects explicit routing partitioning.';

COMMIT;

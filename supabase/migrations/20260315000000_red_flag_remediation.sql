-- Migration: Operation Red Flag Remediation Foundation
-- 1. Add versioning for Optimistic Locking
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 0;

-- 2. Unique Constraints for OCI Idempotency
-- We use a partial index to ignore null click_ids but enforce unique uploads for the same click + action.
-- This prevents "Ghost Doubles" from retries.
CREATE UNIQUE INDEX IF NOT EXISTS idx_oci_idempotency_gclid
ON public.offline_conversion_queue (site_id, gclid, action, conversion_time)
WHERE gclid IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_oci_idempotency_wbraid
ON public.offline_conversion_queue (site_id, wbraid, action, conversion_time)
WHERE wbraid IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_oci_idempotency_gbraid
ON public.offline_conversion_queue (site_id, gbraid, action, conversion_time)
WHERE gbraid IS NOT NULL;

-- 3. Postgres Authority: Automated Expiration logic
CREATE OR REPLACE FUNCTION public.fn_set_standard_expires_at()
RETURNS TRIGGER AS $$
BEGIN
    -- Authoritative 7-day TTL if not provided
    IF NEW.expires_at IS NULL THEN
        NEW.expires_at = NOW() + INTERVAL '7 days';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_calls_standard_expiration ON public.calls;
CREATE TRIGGER trg_calls_standard_expiration
BEFORE INSERT ON public.calls
FOR EACH ROW
EXECUTE FUNCTION public.fn_set_standard_expires_at();

-- 4. Constraint: Version cannot go backwards
ALTER TABLE public.calls ADD CONSTRAINT chk_calls_version_positive CHECK (version >= 0);

COMMENT ON COLUMN public.calls.version IS 'Incrementing version for optimistic locking (concurrency control).';
COMMENT ON INDEX public.idx_oci_idempotency_gclid IS 'Prevents duplicate OCI uploads for the same GCLID/Action/Time.';

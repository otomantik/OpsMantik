-- =============================================================================
-- CRITICAL LOCKDOWN: Fraud quarantine layer.
-- High-frequency/suspicious events are routed here instead of primary Calls/Conversions.
-- Prevents silent poisoning of analytics and attribution.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.ingest_fraud_quarantine (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
    payload JSONB NOT NULL,
    reason TEXT NOT NULL,
    fingerprint TEXT,
    ip_address TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ingest_fraud_quarantine_site_created
    ON public.ingest_fraud_quarantine(site_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ingest_fraud_quarantine_reason
    ON public.ingest_fraud_quarantine(reason);

COMMENT ON TABLE public.ingest_fraud_quarantine IS
    'Quarantine for suspicious/high-frequency events. Never hits Calls/Conversions. Manual review required.';

ALTER TABLE public.ingest_fraud_quarantine ENABLE ROW LEVEL SECURITY;

GRANT INSERT, SELECT ON public.ingest_fraud_quarantine TO service_role;

-- =============================================================================
-- GDPR Compliance: gdpr_erase_requests table
-- Silme talepleri takibi; audit için
-- audit_log zaten mevcut (20260219100000_audit_log_g5.sql)
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.gdpr_erase_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  identifier_type text NOT NULL CHECK (identifier_type IN ('email', 'fingerprint', 'session_id')),
  identifier_value text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

COMMENT ON TABLE public.gdpr_erase_requests IS 'KVKK/GDPR: Silme talepleri. Erase işlemi tamamlandığında completed_at set edilir.';

CREATE INDEX IF NOT EXISTS idx_gdpr_erase_requests_site_id ON public.gdpr_erase_requests(site_id);
CREATE INDEX IF NOT EXISTS idx_gdpr_erase_requests_status ON public.gdpr_erase_requests(status);
CREATE INDEX IF NOT EXISTS idx_gdpr_erase_requests_identifier ON public.gdpr_erase_requests(identifier_type, identifier_value);

ALTER TABLE public.gdpr_erase_requests ENABLE ROW LEVEL SECURITY;

-- Only service_role can access (API uses admin client)
GRANT SELECT, INSERT, UPDATE ON public.gdpr_erase_requests TO service_role;

COMMIT;

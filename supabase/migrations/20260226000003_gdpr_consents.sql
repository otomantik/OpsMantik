-- =============================================================================
-- GDPR Consent storage (server-recorded consent, e.g. CMP callback)
-- Sync uses payload consent or optional lookup here.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.gdpr_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  identifier_type text NOT NULL CHECK (identifier_type IN ('fingerprint', 'session_id')),
  identifier_value text NOT NULL,
  consent_scopes text[] NOT NULL DEFAULT '{}',
  consent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(site_id, identifier_type, identifier_value)
);

COMMENT ON TABLE public.gdpr_consents IS 'DEPRECATED: Use sessions.consent_at, sessions.consent_scopes. Kept for backward compat during migration.';

CREATE INDEX IF NOT EXISTS idx_gdpr_consents_site_identifier
  ON public.gdpr_consents(site_id, identifier_type, identifier_value);

ALTER TABLE public.gdpr_consents ENABLE ROW LEVEL SECURITY;
GRANT INSERT, SELECT, UPDATE ON public.gdpr_consents TO service_role;

COMMIT;

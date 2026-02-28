-- Add oci_api_key to sites for true multi-tenancy (DB-stored API keys)
-- Iron Seal: Each site has its own OCI API key; no env-based OCI_API_KEYS

ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS oci_api_key TEXT UNIQUE;

COMMENT ON COLUMN public.sites.oci_api_key IS 'Site-scoped OCI API key for verify/export/ack. Unique, nullable until configured.';

CREATE INDEX IF NOT EXISTS idx_sites_oci_api_key ON public.sites (oci_api_key) WHERE oci_api_key IS NOT NULL;

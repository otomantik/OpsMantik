-- =============================================================================
-- Tenant entitlements: active_modules per site (modular SaaS)
-- Default: core_oci, scoring_v1. Add google_ads_spend per tenant as needed.
-- =============================================================================

BEGIN;

ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS active_modules text[] DEFAULT ARRAY['core_oci', 'scoring_v1']::text[];

UPDATE public.sites
SET active_modules = ARRAY['core_oci', 'scoring_v1']::text[]
WHERE active_modules IS NULL;

ALTER TABLE public.sites
  ALTER COLUMN active_modules SET NOT NULL;

COMMENT ON COLUMN public.sites.active_modules IS
  'Tenant feature entitlements. Only listed modules are enabled for this site.';

COMMIT;

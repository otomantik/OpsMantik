BEGIN;

ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS domain text NULL,
  ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'TRY',
  ADD COLUMN IF NOT EXISTS active_modules text[] NOT NULL DEFAULT ARRAY['dashboard']::text[],
  ADD COLUMN IF NOT EXISTS config jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS oci_sync_method text NOT NULL DEFAULT 'script',
  ADD COLUMN IF NOT EXISTS oci_api_key text NULL,
  ADD COLUMN IF NOT EXISTS oci_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS default_country_iso text NOT NULL DEFAULT 'TR',
  ADD COLUMN IF NOT EXISTS default_aov numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS intent_weights jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS min_conversion_value_cents integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'sites_domain_key'
  ) THEN
    CREATE UNIQUE INDEX sites_domain_key
      ON public.sites(domain)
      WHERE domain IS NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'sites'
      AND policyname = 'sites_owner_read'
  ) THEN
    CREATE POLICY sites_owner_read ON public.sites
    FOR SELECT USING (sites.user_id = auth.uid());
  END IF;
END $$;

COMMIT;

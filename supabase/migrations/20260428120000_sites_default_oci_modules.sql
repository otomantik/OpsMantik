-- Ensure every site can use signed call-event and scoring: default entitlements on new rows + backfill existing.
BEGIN;

ALTER TABLE public.sites
  ALTER COLUMN active_modules
  SET DEFAULT ARRAY['dashboard', 'core_oci', 'scoring_v1']::text[];

UPDATE public.sites
SET active_modules = array_append(active_modules, 'core_oci')
WHERE NOT (active_modules @> ARRAY['core_oci']::text[]);

UPDATE public.sites
SET active_modules = array_append(active_modules, 'scoring_v1')
WHERE NOT (active_modules @> ARRAY['scoring_v1']::text[]);

COMMIT;

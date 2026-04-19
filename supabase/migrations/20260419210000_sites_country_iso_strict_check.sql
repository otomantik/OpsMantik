-- Phase 5 — strict CHECK on sites.default_country_iso.
-- Pairs with 20260419200000 (currency + timezone CHECKs). We already
-- neutralized the TR fallbacks in the runtime paths; this migration stops
-- invalid values sneaking into the column from ops scripts / admin forms.
--
-- Shape: ISO-3166-1 alpha-2 — exactly two uppercase ASCII letters.
-- NULL is allowed so existing behaviour (fallback to 'TR' in lib/dic/phone-hash.ts)
-- stays unchanged for pre-migration rows that never set the column.
--
-- Rollback:
--   ALTER TABLE public.sites DROP CONSTRAINT IF EXISTS sites_default_country_iso_chk;

BEGIN;

-- Backfill any stragglers to the neutral 'US' default so the CHECK can apply.
UPDATE public.sites
SET default_country_iso = 'US'
WHERE default_country_iso IS NOT NULL
  AND default_country_iso !~ '^[A-Z]{2}$';

ALTER TABLE public.sites
  DROP CONSTRAINT IF EXISTS sites_default_country_iso_chk;

ALTER TABLE public.sites
  ADD CONSTRAINT sites_default_country_iso_chk
  CHECK (
    default_country_iso IS NULL
    OR default_country_iso ~ '^[A-Z]{2}$'
  );

COMMENT ON CONSTRAINT sites_default_country_iso_chk ON public.sites IS
  'Phase 5 — f5 hardening: enforce ISO-3166-1 alpha-2 shape on default_country_iso. NULL allowed for legacy rows; runtime helpers fall back appropriately.';

COMMIT;

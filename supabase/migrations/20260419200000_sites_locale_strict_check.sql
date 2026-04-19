-- Phase 4 — f4-global-hardcodes
-- Enforce ISO-4217 currency and IANA timezone on sites.
-- Neutral defaults (USD/UTC) already in place since 20260228100000.
-- This migration adds CHECK constraints so future writes cannot sneak in junk like ''
-- or 'INVALID' that used to get papered over by hardcoded TRY/Europe-Istanbul fallbacks.
--
-- Rollback:
--   ALTER TABLE public.sites DROP CONSTRAINT IF EXISTS sites_currency_iso4217_chk;
--   ALTER TABLE public.sites DROP CONSTRAINT IF EXISTS sites_timezone_iana_chk;

BEGIN;

-- 1) Backfill any stragglers — paranoid safety before adding CHECK.
UPDATE public.sites
SET currency = 'USD'
WHERE currency IS NULL OR btrim(currency) = '' OR currency !~ '^[A-Z]{3}$';

UPDATE public.sites
SET timezone = 'UTC'
WHERE timezone IS NULL OR btrim(timezone) = '' OR timezone !~ '^[A-Za-z][A-Za-z0-9_+-]+(/[A-Za-z][A-Za-z0-9_+-]+)?$';

-- 2) Currency: exactly 3 uppercase ASCII letters (ISO-4217 shape).
--    We do NOT validate against the living ISO-4217 list — new codes appear
--    (e.g. regional stablecoins, CBDCs). Shape is enough to catch bugs.
ALTER TABLE public.sites
  DROP CONSTRAINT IF EXISTS sites_currency_iso4217_chk;

ALTER TABLE public.sites
  ADD CONSTRAINT sites_currency_iso4217_chk
  CHECK (currency ~ '^[A-Z]{3}$');

-- 3) Timezone: IANA shape (Area/Location) OR 'UTC'.
--    Matches patterns like 'UTC', 'Europe/Istanbul', 'America/Argentina/Buenos_Aires'.
ALTER TABLE public.sites
  DROP CONSTRAINT IF EXISTS sites_timezone_iana_chk;

ALTER TABLE public.sites
  ADD CONSTRAINT sites_timezone_iana_chk
  CHECK (
    timezone = 'UTC'
    OR timezone ~ '^[A-Za-z][A-Za-z0-9_+-]+(/[A-Za-z][A-Za-z0-9_+-]+){1,2}$'
  );

COMMENT ON CONSTRAINT sites_currency_iso4217_chk ON public.sites IS
  'Phase 4 — f4-global-hardcodes: enforce ISO-4217 shape on currency. Neutral default USD.';
COMMENT ON CONSTRAINT sites_timezone_iana_chk ON public.sites IS
  'Phase 4 — f4-global-hardcodes: enforce IANA shape on timezone. Neutral default UTC.';

COMMIT;

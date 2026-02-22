-- Migration: Add timezone and locale to sites for i18n (Turkish pilot + global readiness)
-- Idempotent. Backfill existing rows with legacy Turkish defaults; new rows get USD/UTC/en-US.
--
-- Verification (should return 0 after migration):
--   SELECT COUNT(*) FROM sites WHERE currency IS NULL OR timezone IS NULL OR locale IS NULL;

BEGIN;

-- 1) Add nullable columns (currency already exists from 20260129000000)
ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS timezone text,
  ADD COLUMN IF NOT EXISTS locale text;

-- 2) Backfill ALL existing rows with legacy Turkish defaults
UPDATE public.sites
SET
  currency = COALESCE(NULLIF(trim(currency), ''), 'TRY'),
  timezone = COALESCE(NULLIF(trim(timezone), ''), 'Europe/Istanbul'),
  locale = COALESCE(NULLIF(trim(locale), ''), 'tr-TR')
WHERE currency IS NULL OR timezone IS NULL OR locale IS NULL;

-- 3) Set DEFAULT for new rows (global defaults)
ALTER TABLE public.sites ALTER COLUMN currency SET DEFAULT 'USD';
ALTER TABLE public.sites ALTER COLUMN timezone SET DEFAULT 'UTC';
ALTER TABLE public.sites ALTER COLUMN locale SET DEFAULT 'en-US';

-- 4) Set NOT NULL (backfill guarantees no nulls)
ALTER TABLE public.sites ALTER COLUMN currency SET NOT NULL;
ALTER TABLE public.sites ALTER COLUMN timezone SET NOT NULL;
ALTER TABLE public.sites ALTER COLUMN locale SET NOT NULL;

COMMENT ON COLUMN public.sites.timezone IS 'IANA timezone for display (e.g. Europe/Istanbul, UTC).';
COMMENT ON COLUMN public.sites.locale IS 'BCP-47 locale for formatting (e.g. tr-TR, en-US).';

COMMIT;

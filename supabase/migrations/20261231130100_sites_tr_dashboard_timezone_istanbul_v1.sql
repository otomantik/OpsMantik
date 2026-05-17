-- Align dashboard today/yesterday boundaries (queue + stats date windows) with TR business day.
-- Prod had one TR storefront still on schema default timezone=UTC while others use Europe/Istanbul.

BEGIN;

UPDATE public.sites
SET
  timezone = 'Europe/Istanbul',
  updated_at = now()
WHERE default_country_iso = 'TR'
  AND upper(trim(timezone)) = 'UTC';

COMMIT;

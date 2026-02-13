-- Migration: Rename customer domain (Kaliteli Bakıcı -> tecrubelibakici.com)
-- Date: 2026-02-13
-- Purpose:
--   - Update existing site row(s) to new domain to avoid duplicate site creation.
--   - Rename the display name if it contains the old brand keyword.
--
-- Safety:
--   - Targets only rows whose domain matches the known old domain(s),
--     OR rows already moved to tecrubelibakici.com but still carrying the old name.

BEGIN;

DO $$
DECLARE
  has_updated_at boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sites'
      AND column_name = 'updated_at'
  ) INTO has_updated_at;

  IF has_updated_at THEN
    UPDATE public.sites
    SET
      domain = 'tecrubelibakici.com',
      name = CASE
        WHEN name IS NOT NULL AND lower(name) LIKE '%kaliteli%bak%' THEN 'Tecrübeli Bakıcı'
        ELSE name
      END,
      updated_at = NOW()
    WHERE lower(domain) IN (
      'kalitelibakici.com',
      'www.kalitelibakici.com',
      'tecrubelibakici.com',
      'www.tecrubelibakici.com'
    )
      OR (name IS NOT NULL AND lower(name) LIKE '%kaliteli%bak%');
  ELSE
    UPDATE public.sites
    SET
      domain = 'tecrubelibakici.com',
      name = CASE
        WHEN name IS NOT NULL AND lower(name) LIKE '%kaliteli%bak%' THEN 'Tecrübeli Bakıcı'
        ELSE name
      END
    WHERE lower(domain) IN (
      'kalitelibakici.com',
      'www.kalitelibakici.com',
      'tecrubelibakici.com',
      'www.tecrubelibakici.com'
    )
      OR (name IS NOT NULL AND lower(name) LIKE '%kaliteli%bak%');
  END IF;
END $$;

COMMIT;


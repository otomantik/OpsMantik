-- OPTIONAL: Apply manually if idx_sessions_site_fingerprint is missing.
-- Verify first: SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='sessions' AND indexname='idx_sessions_site_fingerprint';
-- If no row returned, run this migration. DO NOT auto-apply.
BEGIN;
CREATE INDEX IF NOT EXISTS idx_sessions_site_fingerprint
  ON public.sessions(site_id, fingerprint)
  WHERE fingerprint IS NOT NULL;
COMMENT ON INDEX idx_sessions_site_fingerprint IS 'Call-event/GDPR: tenant-scoped fingerprint lookups. Avoids full scan under load.';
COMMIT;

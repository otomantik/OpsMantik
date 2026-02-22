-- Call-event / GDPR: sessions(site_id, fingerprint) index
-- Avoids full scan when matching sessions by fingerprint (export, erase, consent lookup).
-- idx_sessions_fingerprint exists but (site_id, fingerprint) composite is faster for tenant-scoped queries.
BEGIN;
CREATE INDEX IF NOT EXISTS idx_sessions_site_fingerprint
  ON public.sessions(site_id, fingerprint)
  WHERE fingerprint IS NOT NULL;
COMMENT ON INDEX idx_sessions_site_fingerprint IS 'Call-event/GDPR: tenant-scoped fingerprint lookups. Avoids full scan under load.';
COMMIT;

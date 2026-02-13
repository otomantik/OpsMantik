-- AttributionService: past GCLID lookup is scoped by site_id + metadata->>'fingerprint'.
-- This index supports WHERE site_id = ? AND metadata->>'fingerprint' = ? AND metadata->'gclid' IS NOT NULL
-- and ORDER BY created_at DESC LIMIT 1 (no performance regression).
CREATE INDEX IF NOT EXISTS idx_events_site_fingerprint_created
  ON public.events (site_id, (metadata->>'fingerprint'), created_at DESC)
  WHERE metadata->>'fingerprint' IS NOT NULL AND metadata->'gclid' IS NOT NULL;

COMMENT ON INDEX idx_events_site_fingerprint_created IS
  'Attribution past-GCLID lookup: site-scoped + fingerprint in SQL; prevents cross-tenant scan.';

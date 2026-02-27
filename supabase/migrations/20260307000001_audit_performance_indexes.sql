-- =============================================================================
-- Audit Performance Indexes: FK + composite for hot queries.
-- Plain CREATE INDEX (no CONCURRENTLY) for migration transaction compatibility.
-- =============================================================================

BEGIN;

-- calls: composite for use-visitor-history (.eq('site_id', X).eq('matched_fingerprint', Y))
CREATE INDEX IF NOT EXISTS idx_calls_site_id_matched_fingerprint
  ON public.calls (site_id, matched_fingerprint)
  WHERE matched_fingerprint IS NOT NULL;

COMMENT ON INDEX public.idx_calls_site_id_matched_fingerprint IS
  'Visitor history: site_id + matched_fingerprint lookup.';

-- calls: composite for RLS and status filters (site_id + status)
CREATE INDEX IF NOT EXISTS idx_calls_site_id_status
  ON public.calls (site_id, status)
  WHERE status IS NOT NULL;

COMMENT ON INDEX public.idx_calls_site_id_status IS
  'Dashboard/intent filters: site_id + status.';

-- offline_conversion_queue: call_id FK (for JOINs in export/dedup)
-- call_id already has UNIQUE idx; no duplicate needed.

-- site_members: (site_id, user_id) already exists as idx_site_members_site_user.

COMMIT;

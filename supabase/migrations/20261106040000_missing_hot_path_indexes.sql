-- Migration: missing hot-path indexes (P3-L2)
--
-- These columns appear in WHERE / JOIN conditions on high-frequency query paths
-- but had no dedicated index, causing seq-scans as the table grows.

-- 1. marketing_signals.call_id
--    Used by: hasRecentV2Pulse (V2 gear dedup), attribution queries,
--    and any signal lookup by call.  The site_id+call_id combo is the most
--    common predicate pattern (always scoped by tenant).
CREATE INDEX IF NOT EXISTS idx_marketing_signals_site_call_id
  ON public.marketing_signals (site_id, call_id)
  WHERE call_id IS NOT NULL;

COMMENT ON INDEX public.idx_marketing_signals_site_call_id IS
  'Hot-path: tenant-scoped signal lookups by call_id (dedup, attribution, gear queries).';

-- 2. marketing_signals.signal_type (site_id + signal_type partial)
--    Used by: V2 INTENT_CAPTURED dedup check within hasRecentV2Pulse.
CREATE INDEX IF NOT EXISTS idx_marketing_signals_site_type
  ON public.marketing_signals (site_id, signal_type);

COMMENT ON INDEX public.idx_marketing_signals_site_type IS
  'Hot-path: gear dedup checks filtered by signal_type (e.g. INTENT_CAPTURED) per site.';

-- 3. outbox_events.call_id
--    Used by: invalidatePendingOciArtifactsForCall and zombie sweep queries filtering by call.
--    Note: outbox_events has call_id (not aggregate_id); idx_outbox_events_site_status covers
--    status-only scans. A site+call_id covering index speeds up per-call invalidation.
CREATE INDEX IF NOT EXISTS idx_outbox_events_site_call_id
  ON public.outbox_events (site_id, call_id)
  WHERE call_id IS NOT NULL;

COMMENT ON INDEX public.idx_outbox_events_site_call_id IS
  'Hot-path: per-call OCI artifact invalidation (junk/restore/cancel flows).';

-- 4. billing_compensation_failures.site_id + created_at (added in P1)
--    The DLQ table has no indexes; reconciliation queries will need to scan by site.
CREATE INDEX IF NOT EXISTS idx_billing_compensation_failures_site_created
  ON public.billing_compensation_failures (site_id, created_at DESC);

COMMENT ON INDEX public.idx_billing_compensation_failures_site_created IS
  'DLQ reconciliation queries scoped by site and time.';

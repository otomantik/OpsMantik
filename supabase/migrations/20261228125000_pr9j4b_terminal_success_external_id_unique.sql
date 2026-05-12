-- PR-9J.4b: prevent duplicate terminal-success uploads per site/provider/external_id.
--
-- This intentionally runs after PR-9J.4a, which voids historical duplicates.

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_offline_conversion_queue_terminal_success_dedup
ON public.offline_conversion_queue (site_id, provider_key, external_id)
WHERE status IN ('COMPLETED', 'UPLOADED', 'COMPLETED_UNVERIFIED');

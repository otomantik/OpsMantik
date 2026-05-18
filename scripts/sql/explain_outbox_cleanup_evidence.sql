-- PR-B1 evidence: run before/after idx_outbox_events_cleanup_processed migration.
-- Expect Index Scan on idx_outbox_events_cleanup_processed after fix.

EXPLAIN (ANALYZE, BUFFERS)
SELECT id
FROM public.outbox_events
WHERE status = 'PROCESSED'
  AND processed_at IS NOT NULL
  AND processed_at < now() - interval '7 days'
ORDER BY processed_at ASC
LIMIT 5000;

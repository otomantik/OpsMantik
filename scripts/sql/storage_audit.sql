-- Storage retention audit (read-only). Run in Supabase SQL Editor with service_role context.
-- PR-A0: STORAGE_RETENTION_KERNEL_AUDIT_FIRST — no mutations.

-- 1) Top tables by size
SELECT
  c.relname AS table_name,
  pg_total_relation_size(c.oid) AS bytes,
  pg_size_pretty(pg_total_relation_size(c.oid)) AS size_pretty,
  s.n_live_tup,
  s.n_dead_tup,
  CASE WHEN s.n_live_tup > 0 THEN round(100.0 * s.n_dead_tup / s.n_live_tup, 2) ELSE 0 END AS dead_pct
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY bytes DESC
LIMIT 30;

-- 2) pg_stat_statements (if extension enabled)
SELECT query, calls, mean_exec_time, total_exec_time
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;

-- 3) processed_signals by status
SELECT status, count(*) FROM public.processed_signals GROUP BY status ORDER BY count(*) DESC;

-- 4) Stale processing dedup (>31m)
SELECT count(*) AS stale_processing
FROM public.processed_signals
WHERE status = 'processing' AND created_at < now() - interval '31 minutes';

-- 5) ingest_idempotency eligible (90d) — approximate
SELECT count(*) AS eligible_90d
FROM public.ingest_idempotency
WHERE created_at < now() - interval '90 days';

-- 6) outbox PROCESSED older than 7d
SELECT count(*) AS outbox_processed_old
FROM public.outbox_events
WHERE status = 'PROCESSED' AND processed_at < now() - interval '7 days';

-- 7) OCI terminal queue older than 90d
SELECT count(*) AS queue_terminal_old
FROM public.offline_conversion_queue
WHERE status IN ('COMPLETED', 'FATAL', 'FAILED')
  AND updated_at < now() - interval '90 days';

-- 8) oci_queue_transitions per queue (p50/p95)
SELECT
  percentile_cont(0.5) WITHIN GROUP (ORDER BY cnt) AS p50,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY cnt) AS p95,
  max(cnt) AS max_transitions
FROM (
  SELECT queue_id, count(*) AS cnt
  FROM public.oci_queue_transitions
  GROUP BY queue_id
) s;

-- 9) GDPR consent-less sessions (90d)
SELECT count(*) AS sessions_consentless_90d
FROM public.sessions
WHERE consent_at IS NULL
  AND (consent_scopes IS NULL OR consent_scopes = '{}')
  AND created_at < now() - interval '90 days';

-- 10) Active locks
SELECT pid, wait_event_type, wait_event, state, left(query, 120) AS query
FROM pg_stat_activity
WHERE datname = current_database() AND wait_event_type = 'Lock';

-- 11) cron heartbeats
SELECT job_name, last_status, last_rows_affected, run_count, last_finished_at, last_error_code
FROM public.cron_job_heartbeats
ORDER BY last_finished_at DESC NULLS LAST;

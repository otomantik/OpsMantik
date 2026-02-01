-- =============================================================================
-- DIAGNOSTIC: Sync health check queries (run manually, not auto-applied)
-- =============================================================================

-- 1) Son 1 saatteki session'lar (canlı tracking çalışıyor mu?)
SELECT 
  st.domain,
  COUNT(*) AS sessions_last_hour,
  MAX(s.created_at) AS last_session_at
FROM public.sessions s
JOIN public.sites st ON st.id = s.site_id
WHERE s.created_at >= now() - INTERVAL '1 hour'
GROUP BY 1
ORDER BY sessions_last_hour DESC;

-- 2) Bugünkü session'lar partition'a doğru mu gidiyor? (trigger drift check)
SELECT 
  st.domain,
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE s.created_month <> date_trunc('month', (s.created_at AT TIME ZONE 'utc'))::date) AS drift_count
FROM public.sessions s
JOIN public.sites st ON st.id = s.site_id
WHERE s.created_at >= (date_trunc('day', now() AT TIME ZONE 'Europe/Istanbul') AT TIME ZONE 'Europe/Istanbul')
  AND s.created_at < now()
GROUP BY 1
ORDER BY total DESC;

-- 3) Worker hataları var mı? (sync_dlq son 2 saat)
SELECT 
  COUNT(*) AS dlq_count,
  COUNT(DISTINCT site_id) AS affected_sites,
  array_agg(DISTINCT stage) AS error_stages
FROM public.sync_dlq
WHERE received_at >= now() - INTERVAL '2 hours';

-- 4) Trigger'lar aktif mi?
SELECT 
  trigger_name,
  event_manipulation,
  event_object_table,
  action_statement
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND event_object_table IN ('sessions', 'events')
ORDER BY event_object_table, trigger_name;

-- 5) Bugünkü events session_month ile uyumlu mu?
SELECT 
  st.domain,
  COUNT(*) AS total_events,
  COUNT(*) FILTER (WHERE e.session_month <> s.created_month) AS mismatch_count
FROM public.events e
JOIN public.sessions s ON s.id = e.session_id AND s.created_month = e.session_month
JOIN public.sites st ON st.id = s.site_id
WHERE e.created_at >= (date_trunc('day', now() AT TIME ZONE 'Europe/Istanbul') AT TIME ZONE 'Europe/Istanbul')
  AND e.created_at < now()
GROUP BY 1
ORDER BY total_events DESC;

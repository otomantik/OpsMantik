-- =============================================================================
-- HIZLI DIAGNOSTIC: Şu anda tracking çalışıyor mu?
-- =============================================================================

-- 1) Son 10 dakikada session var mı? (canlı tracking test)
SELECT 
  st.domain,
  COUNT(*) AS sessions_last_10min,
  MAX(s.created_at) AS last_session_at,
  MAX(s.created_at) > now() - INTERVAL '10 minutes' AS is_live
FROM public.sessions s
JOIN public.sites st ON st.id = s.site_id
WHERE s.created_at >= now() - INTERVAL '10 minutes'
GROUP BY 1
ORDER BY sessions_last_10min DESC;

-- 2) Bugünkü session'lar partition'a doğru mu gidiyor? (trigger drift)
SELECT 
  st.domain,
  COUNT(*) AS total_today,
  COUNT(*) FILTER (WHERE s.created_month <> date_trunc('month', (s.created_at AT TIME ZONE 'utc'))::date) AS drift_count
FROM public.sessions s
JOIN public.sites st ON st.id = s.site_id
WHERE s.created_at >= (date_trunc('day', now() AT TIME ZONE 'Europe/Istanbul') AT TIME ZONE 'Europe/Istanbul')
  AND s.created_at < now()
GROUP BY 1
ORDER BY total_today DESC;

-- 3) Worker hataları var mı? (son 1 saat)
SELECT 
  stage,
  COUNT(*) AS error_count,
  array_agg(DISTINCT LEFT(error, 100)) AS sample_errors
FROM public.sync_dlq
WHERE received_at >= now() - INTERVAL '1 hour'
GROUP BY 1
ORDER BY error_count DESC;

-- 4) Bugünkü events session_month ile uyumlu mu?
SELECT 
  st.domain,
  COUNT(*) AS total_events_today,
  COUNT(*) FILTER (WHERE e.session_month <> s.created_month) AS mismatch_count
FROM public.events e
JOIN public.sessions s ON s.id = e.session_id
JOIN public.sites st ON st.id = s.site_id
WHERE e.created_at >= (date_trunc('day', now() AT TIME ZONE 'Europe/Istanbul') AT TIME ZONE 'Europe/Istanbul')
  AND e.created_at < now()
GROUP BY 1
ORDER BY total_events_today DESC;

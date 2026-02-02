-- =============================================================================
-- ACİL KONTROL: Pay-as-you-go sonrası sistem çalışıyor mu?
-- =============================================================================

-- 1. Son 5 dakikada signal var mı? (QStash çalışıyor mu?)
SELECT 
  COUNT(*) AS signals_last_5min,
  MAX(received_at) AS last_signal_at,
  EXTRACT(EPOCH FROM (now() - MAX(received_at)))/60 AS minutes_ago,
  CASE 
    WHEN COUNT(*) > 0 THEN '✅ QStash ÇALIŞİYOR'
    ELSE '❌ Hâlâ mesaj gelmiyor'
  END AS status
FROM public.processed_signals
WHERE received_at >= now() - INTERVAL '5 minutes';

-- 2. Son worker hatası ne? (varsa)
SELECT 
  received_at,
  stage,
  error,
  payload->>'s' AS site_public_id
FROM public.sync_dlq
ORDER BY received_at DESC
LIMIT 3;

-- 3. Bugünkü toplam session/signal durumu
SELECT 
  (SELECT COUNT(*) FROM public.sessions 
   WHERE created_at >= (date_trunc('day', now() AT TIME ZONE 'Europe/Istanbul') AT TIME ZONE 'Europe/Istanbul')
   AND created_at < now()) AS sessions_today,
  (SELECT COUNT(*) FROM public.processed_signals 
   WHERE received_at >= (date_trunc('day', now() AT TIME ZONE 'Europe/Istanbul') AT TIME ZONE 'Europe/Istanbul')
   AND received_at < now()) AS signals_today;

-- 4. En son ne zaman session oluştu?
SELECT 
  MAX(created_at) AS last_session_at,
  EXTRACT(EPOCH FROM (now() - MAX(created_at)))/60 AS minutes_ago
FROM public.sessions;

-- 5. Bugünkü veriler site bazında
SELECT 
  st.domain,
  COUNT(DISTINCT s.id) AS sessions_today,
  MAX(s.created_at) AS last_session_at
FROM public.sites st
LEFT JOIN public.sessions s 
  ON s.site_id = st.id 
  AND s.created_at >= (date_trunc('day', now() AT TIME ZONE 'Europe/Istanbul') AT TIME ZONE 'Europe/Istanbul')
  AND s.created_at < now()
GROUP BY st.domain
ORDER BY sessions_today DESC NULLS LAST;

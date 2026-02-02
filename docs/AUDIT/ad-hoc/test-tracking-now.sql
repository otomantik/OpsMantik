-- =============================================================================
-- QStash Deploy Sonrası Test - ŞİMDİ
-- =============================================================================

-- 1. Son 10 dakikada signal var mı? (QStash mesajları)
SELECT 
  'Signals (Last 10min)' AS check_name,
  COUNT(*) AS count,
  MAX(received_at) AS last_at,
  EXTRACT(EPOCH FROM (now() - MAX(received_at)))/60 AS minutes_ago,
  CASE 
    WHEN COUNT(*) > 0 THEN '✅ QStash çalışıyor!'
    ELSE '❌ Hâlâ mesaj gelmiyor'
  END AS status
FROM public.processed_signals
WHERE received_at >= now() - INTERVAL '10 minutes';

-- 2. Son 10 dakikada session oluştu mu?
SELECT 
  'Sessions (Last 10min)' AS check_name,
  COUNT(*) AS count,
  MAX(created_at) AS last_at,
  EXTRACT(EPOCH FROM (now() - MAX(created_at)))/60 AS minutes_ago,
  CASE 
    WHEN COUNT(*) > 0 THEN '✅ Tracking çalışıyor!'
    ELSE '⏳ Henüz session yok (5-10 dk daha bekle)'
  END AS status
FROM public.sessions
WHERE created_at >= now() - INTERVAL '10 minutes';

-- 3. Son 10 dakikada event oluştu mu?
SELECT 
  'Events (Last 10min)' AS check_name,
  COUNT(*) AS count,
  MAX(created_at) AS last_at,
  EXTRACT(EPOCH FROM (now() - MAX(created_at)))/60 AS minutes_ago,
  CASE 
    WHEN COUNT(*) > 0 THEN '✅ Event pipeline çalışıyor!'
    ELSE '⏳ Henüz event yok'
  END AS status
FROM public.events
WHERE created_at >= now() - INTERVAL '10 minutes';

-- 4. Detaylı: Hangi site'lere trafik geldi? (son 10 dk)
SELECT 
  st.domain,
  COUNT(DISTINCT ps.event_id) AS signals,
  COUNT(DISTINCT s.id) AS sessions,
  MAX(s.created_at) AS last_session_at
FROM public.sites st
LEFT JOIN public.processed_signals ps 
  ON ps.site_id = st.id 
  AND ps.received_at >= now() - INTERVAL '10 minutes'
LEFT JOIN public.sessions s 
  ON s.site_id = st.id 
  AND s.created_at >= now() - INTERVAL '10 minutes'
WHERE ps.event_id IS NOT NULL OR s.id IS NOT NULL
GROUP BY st.id, st.domain
ORDER BY signals DESC;

-- 5. Worker hataları var mı? (son 10 dk)
SELECT 
  'DLQ Errors (Last 10min)' AS check_name,
  COUNT(*) AS error_count,
  CASE 
    WHEN COUNT(*) = 0 THEN '✅ Hata yok'
    ELSE '⚠️ Worker hatası var'
  END AS status
FROM public.sync_dlq
WHERE received_at >= now() - INTERVAL '10 minutes';

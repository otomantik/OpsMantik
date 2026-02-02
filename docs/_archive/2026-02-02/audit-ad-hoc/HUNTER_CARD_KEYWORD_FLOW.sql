-- =============================================================================
-- HUNTER CARD KEYWORD FLOW ANALİZİ
-- Neden ekranda keyword görünmüyor?
-- =============================================================================

-- 1. Bugünkü Hunter Card'larda (calls) keyword var mı?
-- RPC get_recent_intents_v2 bunu döndürür
SELECT 
  c.id AS call_id,
  c.intent_action,
  c.matched_session_id,
  s.utm_term AS session_keyword,
  s.matchtype AS session_matchtype,
  s.gclid,
  c.created_at,
  st.domain
FROM public.calls c
LEFT JOIN public.sessions s ON s.id = c.matched_session_id
JOIN public.sites st ON st.id = c.site_id
WHERE c.created_at >= (date_trunc('day', now() AT TIME ZONE 'Europe/Istanbul') AT TIME ZONE 'Europe/Istanbul')
  AND c.created_at < now()
  AND c.status IN ('intent', 'confirmed')
  AND c.source = 'click'
ORDER BY c.created_at DESC
LIMIT 20;

-- 2. RPC'nin tam olarak ne döndüğünü test et (bugün)
SELECT public.get_recent_intents_v2(
  '01d24667-ca9a-44e3-ab7a-7cd171ae653f'::uuid,  -- poyrazantika.com (ekran görüntüsünde %100)
  (date_trunc('day', now() AT TIME ZONE 'Europe/Istanbul') AT TIME ZONE 'Europe/Istanbul'),
  now(),
  10,
  true
);

-- 3. Session'lar var ama call'a match olmamış mı?
SELECT 
  st.domain,
  COUNT(DISTINCT s.id) AS sessions_with_gclid_today,
  COUNT(DISTINCT c.id) AS calls_today,
  COUNT(DISTINCT s.id) - COUNT(DISTINCT c.matched_session_id) AS sessions_without_call
FROM public.sessions s
JOIN public.sites st ON st.id = s.site_id
LEFT JOIN public.calls c ON c.matched_session_id = s.id AND c.site_id = s.site_id
WHERE s.created_at >= (date_trunc('day', now() AT TIME ZONE 'Europe/Istanbul') AT TIME ZONE 'Europe/Istanbul')
  AND s.created_at < now()
  AND s.gclid IS NOT NULL
GROUP BY st.domain
ORDER BY sessions_with_gclid_today DESC;

-- 4. Bugünkü call'lar matched_session_id ile keyword ilişkisi
SELECT 
  st.domain,
  c.intent_action,
  c.matched_session_id IS NOT NULL AS has_session,
  s.utm_term IS NOT NULL AS has_keyword,
  s.utm_term,
  c.created_at
FROM public.calls c
LEFT JOIN public.sessions s ON s.id = c.matched_session_id
JOIN public.sites st ON st.id = c.site_id
WHERE c.created_at >= (date_trunc('day', now() AT TIME ZONE 'Europe/Istanbul') AT TIME ZONE 'Europe/Istanbul')
  AND c.created_at < now()
  AND c.status IN ('intent', 'confirmed')
ORDER BY c.created_at DESC
LIMIT 20;

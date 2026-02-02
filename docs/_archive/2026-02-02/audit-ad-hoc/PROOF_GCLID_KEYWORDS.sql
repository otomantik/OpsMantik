-- =============================================================================
-- KANIT: GCLID + Keyword'ları Yakalıyoruz
-- =============================================================================

-- 1. KANIT: Bugünkü GCLID'li session'lar ve keyword'ları
SELECT 
  st.domain,
  s.id AS session_id,
  s.gclid,
  s.gbraid,
  s.utm_term AS keyword,
  s.matchtype,
  s.utm_campaign,
  s.utm_source,
  s.utm_medium,
  s.created_at,
  LEFT(s.entry_page, 150) AS entry_page_preview
FROM public.sessions s
JOIN public.sites st ON st.id = s.site_id
WHERE s.created_at >= (date_trunc('day', now() AT TIME ZONE 'Europe/Istanbul') AT TIME ZONE 'Europe/Istanbul')
  AND s.created_at < now()
  AND s.gclid IS NOT NULL
ORDER BY s.created_at DESC
LIMIT 20;

-- 2. ÖZET: Bugünkü GCLID'li session'lar
SELECT 
  st.domain,
  COUNT(*) AS gclid_sessions_today,
  COUNT(*) FILTER (WHERE s.utm_term IS NOT NULL) AS with_keyword,
  COUNT(*) FILTER (WHERE s.matchtype IS NOT NULL) AS with_matchtype,
  ROUND(100.0 * COUNT(*) FILTER (WHERE s.utm_term IS NOT NULL) / COUNT(*), 1) AS keyword_success_rate,
  array_agg(DISTINCT s.utm_term) FILTER (WHERE s.utm_term IS NOT NULL) AS sample_keywords
FROM public.sessions s
JOIN public.sites st ON st.id = s.site_id
WHERE s.created_at >= (date_trunc('day', now() AT TIME ZONE 'Europe/Istanbul') AT TIME ZONE 'Europe/Istanbul')
  AND s.created_at < now()
  AND s.gclid IS NOT NULL
GROUP BY st.domain
ORDER BY gclid_sessions_today DESC;

-- 3. KANIT: Bugünkü call'lar (Hunter Card) ve keyword'ları
SELECT 
  st.domain,
  c.id AS call_id,
  c.intent_action,
  c.matched_session_id,
  s.utm_term AS session_keyword,
  s.matchtype AS session_matchtype,
  s.gclid AS session_gclid,
  c.created_at AS call_created_at,
  s.created_at AS session_created_at
FROM public.calls c
JOIN public.sites st ON st.id = c.site_id
LEFT JOIN public.sessions s ON s.id = c.matched_session_id AND s.site_id = c.site_id
WHERE c.created_at >= (date_trunc('day', now() AT TIME ZONE 'Europe/Istanbul') AT TIME ZONE 'Europe/Istanbul')
  AND c.created_at < now()
  AND c.status IN ('intent', 'confirmed')
  AND c.source = 'click'
ORDER BY c.created_at DESC
LIMIT 20;

-- 4. RPC RESPONSE SİMÜLASYONU: get_recent_intents_v2 ne döndürür?
-- (poyrazantika.com için - ekran görüntüsünde %100 keyword var)
SELECT 
  jsonb_build_object(
    'id', c.id,
    'intent_action', c.intent_action,
    'utm_term', s.utm_term,
    'matchtype', s.matchtype,
    'utm_campaign', s.utm_campaign,
    'utm_source', s.utm_source,
    'utm_medium', s.utm_medium,
    'gclid', s.gclid,
    'city', s.city,
    'district', s.district,
    'device_type', s.device_type,
    'attribution_source', s.attribution_source,
    'lead_score', c.lead_score,
    'created_at', c.created_at
  ) AS rpc_response_simulation
FROM public.calls c
LEFT JOIN public.sessions s ON s.id = c.matched_session_id AND s.site_id = c.site_id
WHERE c.created_at >= (date_trunc('day', now() AT TIME ZONE 'Europe/Istanbul') AT TIME ZONE 'Europe/Istanbul')
  AND c.created_at < now()
  AND c.status IN ('intent', 'confirmed')
  AND c.site_id = '01d24667-ca9a-44e3-ab7a-7cd171ae653f'::uuid  -- poyrazantika
  AND c.source = 'click'
ORDER BY c.created_at DESC
LIMIT 5;

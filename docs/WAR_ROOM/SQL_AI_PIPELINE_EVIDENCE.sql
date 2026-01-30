-- =============================================================================
-- AI PIPELINE KANIT SORGULARI
-- Supabase Dashboard → SQL Editor'da çalıştır. Hunter AI tetikleniyor mu, session
-- güncelleniyor mu kanıtını görürsün.
-- =============================================================================

-- 1) Son 30 günde "high-intent" call sayısı (trigger sadece bunlar için çalışır)
SELECT
  COUNT(*) AS high_intent_calls_last_30d,
  COUNT(*) FILTER (WHERE matched_session_id IS NOT NULL) AS with_matched_session
FROM public.calls
WHERE source = 'click'
  AND intent_action IN ('phone', 'whatsapp')
  AND created_at >= (NOW() - INTERVAL '30 days');

-- 2) Hiç AI doldurulmuş session var mı? (ai_score > 0 veya ai_summary dolu)
SELECT
  COUNT(*) AS sessions_with_ai
FROM public.sessions
WHERE (ai_score > 0 OR ai_summary IS NOT NULL)
  AND created_at >= (NOW() - INTERVAL '90 days');

-- 3) Son 10 high-intent call + ilgili session'da ai_score var mı (kanıt)
SELECT
  c.id AS call_id,
  c.created_at AS call_created,
  c.intent_action,
  c.matched_session_id,
  s.ai_score,
  s.ai_summary IS NOT NULL AS has_summary,
  CASE WHEN s.id IS NULL THEN 'session_yok' WHEN s.ai_score > 0 THEN 'ai_dolu' ELSE 'ai_0' END AS durum
FROM public.calls c
LEFT JOIN public.sessions s ON s.id = c.matched_session_id
WHERE c.source = 'click'
  AND c.intent_action IN ('phone', 'whatsapp')
  AND c.created_at >= (NOW() - INTERVAL '30 days')
ORDER BY c.created_at DESC
LIMIT 10;

-- 4) Son AI doldurulmuş 5 session (tarih + skor)
SELECT
  id,
  created_at,
  ai_score,
  LEFT(ai_summary, 80) AS ai_summary_preview,
  ai_tags
FROM public.sessions
WHERE ai_score > 0 OR ai_summary IS NOT NULL
ORDER BY created_at DESC
LIMIT 5;

-- 5) private.api_keys var mı? (trigger'ın hunter-ai'ya istek atması için gerekli)
-- Not: Sadece key_name listesi; değerler gösterilmez.
SELECT key_name FROM private.api_keys ORDER BY key_name;

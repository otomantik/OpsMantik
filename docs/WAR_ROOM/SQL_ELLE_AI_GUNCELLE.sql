-- =============================================================================
-- Elle AI güncelleme: En son girişin (call) session'ına ai_score, ai_summary,
-- ai_tags yaz. Dashboard'da HOT LEAD + AI Özet görünür; AI çalışıyor mu test edilir.
-- Supabase SQL Editor'da çalıştır.
-- =============================================================================

-- 1) En son call'ın session'ını güncelle (matched_session_id dolu olan en son kayıt)
WITH son_call AS (
  SELECT id, matched_session_id, created_at, intent_action, intent_target
  FROM public.calls
  WHERE source = 'click'
    AND matched_session_id IS NOT NULL
  ORDER BY created_at DESC
  LIMIT 1
)
UPDATE public.sessions s
SET
  ai_score = 85,
  ai_summary = 'Elle güncellendi: Yüksek niyetli lead. Fiyat sayfasından WhatsApp ile ulaştı.',
  ai_tags = ARRAY['high-intent', 'whatsapp', 'fiyat-odakli']
FROM son_call c
WHERE s.id = c.matched_session_id
  AND c.matched_session_id IS NOT NULL;

-- Kaç satır güncellendi görmek için (yukarıdaki UPDATE'ten sonra):
-- SELECT id, ai_score, ai_summary, ai_tags FROM public.sessions WHERE ai_summary LIKE 'Elle güncellendi%' LIMIT 1;

-- 2) Hunter AI çalışıyor mu kontrol (opsiyonel)
-- Son 24 saatte AI tarafından doldurulmuş session var mı? (ai_summary dolu, "Elle" ile başlamayan)
/*
SELECT s.id, s.ai_score, s.ai_summary, s.ai_tags, s.created_at
FROM public.sessions s
WHERE s.ai_summary IS NOT NULL
  AND s.ai_summary NOT LIKE 'Elle güncellendi%'
  AND s.created_at > NOW() - INTERVAL '24 hours'
ORDER BY s.created_at DESC
LIMIT 5;
*/
-- Sonuç 0 satırsa: Henüz Hunter AI (trigger + Edge Function) bu session'ları işlememiş demektir.

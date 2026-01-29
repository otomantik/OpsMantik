-- =============================================================================
-- SECTOR BRAVO — Tank Tracker: "Veri sunucuya ulaştı mı?" kanıtı
-- Supabase SQL Editor'da çalıştır. Son 5 dakikada gelen event'leri gösterir.
-- =============================================================================

-- Son 5 dakikada gelen event sayısı
SELECT
  COUNT(*) AS son_5_dk_event_sayisi,
  COUNT(*) FILTER (WHERE site_id IS NOT NULL) AS site_id_dolu
FROM public.events
WHERE created_at >= NOW() - INTERVAL '5 minutes';

-- Son 10 event (id, site_id, event_action, created_at)
SELECT id, site_id, event_action, event_category, created_at
FROM public.events
ORDER BY created_at DESC
LIMIT 10;

-- =============================================================================
-- Eslamed: PROCESSING'dekileri ayır — Google'a giden = COMPLETED, gitmeyen = QUEUED
-- Script bizi ack'lemediği için elle ayırıyoruz. İleride script POST /api/oci/ack çağırınca otomatik olacak.
-- Site: b1264552-c859-40cb-a3fb-0ba057afd070
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) PROCESSING'deki tüm queue satırlarını listele (hangi id'ler Google'a gitti karar ver)
-- -----------------------------------------------------------------------------
SELECT
  oq.id AS queue_id,
  oq.call_id,
  oq.status,
  oq.claimed_at,
  oq.conversion_time,
  c.matched_session_id
FROM offline_conversion_queue oq
LEFT JOIN calls c ON c.id = oq.call_id AND c.site_id = oq.site_id
WHERE oq.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
  AND oq.status = 'PROCESSING'
ORDER BY oq.claimed_at;


-- -----------------------------------------------------------------------------
-- 2) (İsteğe bağlı) Google'a GİTTİĞİNİ bildiğin queue_id'leri COMPLETED yap.
--    Aşağıdaki id listesini doldur, sonra bu UPDATE'i çalıştır.
-- -----------------------------------------------------------------------------
-- UPDATE offline_conversion_queue
-- SET status = 'COMPLETED', uploaded_at = now(), updated_at = now()
-- WHERE site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
--   AND status = 'PROCESSING'
--   AND id IN (
--     '11be2886-46ab-4345-b9ed-f7d3e7f861de'  -- giden queue_id
--   );


-- -----------------------------------------------------------------------------
-- 3) Tüm PROCESSING'dekileri tekrar QUEUED yap (script tekrar göndersin)
--    "Giden" varsa önce 2'yi uncomment edip çalıştır; yoksa sadece bunu çalıştır.
-- -----------------------------------------------------------------------------
UPDATE offline_conversion_queue
SET status = 'QUEUED', claimed_at = NULL, updated_at = now()
WHERE site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
  AND status = 'PROCESSING';

-- =============================================================================
-- Eslamed: Google'a gönderilen dönüşümlerin listesi
-- Site: b1264552-c859-40cb-a3fb-0ba057afd070
-- Supabase SQL Editor'da çalıştır.
-- =============================================================================

-- 0) Tanı: Kuyrukta kaç kayıt var, hangi durumda? (0 gelirse script hiç çalışmamış veya kuyruk boş)
SELECT
  status AS queue_status,
  COUNT(*) AS adet,
  COUNT(*) FILTER (WHERE uploaded_at IS NOT NULL) AS uploaded_at_dolu
FROM offline_conversion_queue
WHERE site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
GROUP BY status
ORDER BY status;

-- -----------------------------------------------------------------------------
-- PROCESSING'de takılı kayıt varsa (adet > 0, uploaded_at_dolu = 0):
-- Script export'tan almış ama ack çağrılmamış. İki seçenek:
--
-- A) Recover + Script tekrar: Recover cron ile PROCESSING → RETRY yap, sonra
--    Google Ads Script'i tekrar çalıştır. Script export'tan alır, upload eder,
--    ack çağırır → COMPLETED + uploaded_at dolar. (Order ID ile Google zaten
--    duplicate'ı eler, çift sayılmaz.)
--    Örnek (Vercel cron secret ile):
--    curl -X GET "https://console.opsmantik.com/api/cron/providers/recover-processing?min_age_minutes=1" -H "Authorization: Bearer CRON_SECRET"
--
-- B) Elle RETRY yapıp script'i çalıştırmak: docs/runbooks/oci_eslamed_processing_ayir.sql
--    içindeki UPDATE (PROCESSING → QUEUED) ile aynı etki; sonra script'i çalıştır.
-- -----------------------------------------------------------------------------

-- Google'a gidenler = offline_conversion_queue.status = 'COMPLETED', uploaded_at dolu
SELECT
  oq.id AS queue_id,
  oq.call_id,
  oq.conversion_time AS donusum_zamani,
  oq.value_cents / 100.0 AS deger_birim,
  oq.currency,
  oq.uploaded_at AS google_a_gonderim_zamani,
  oq.provider_request_id,
  c.confirmed_at AS muhur_zamani,
  c.lead_score,
  c.sale_amount,
  oq.gclid,
  oq.session_id
FROM offline_conversion_queue oq
LEFT JOIN calls c ON c.id = oq.call_id AND c.site_id = oq.site_id
WHERE oq.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
  AND oq.status = 'COMPLETED'
  AND oq.uploaded_at IS NOT NULL
ORDER BY oq.uploaded_at DESC;

-- Özet: toplam kaç dönüşüm Google'a gitti, son 24 saat / 7 gün / tümü
SELECT
  COUNT(*) FILTER (WHERE oq.uploaded_at >= now() - interval '24 hours') AS son_24_saat,
  COUNT(*) FILTER (WHERE oq.uploaded_at >= now() - interval '7 days')   AS son_7_gun,
  COUNT(*)                                                               AS toplam
FROM offline_conversion_queue oq
WHERE oq.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
  AND oq.status = 'COMPLETED'
  AND oq.uploaded_at IS NOT NULL;

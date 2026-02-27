-- =============================================================================
-- Eslamed OCI Forensic Audit — Bugünkü Dönüşümler
-- Mission: 6–7 mühürlenen dönüşümden sadece 1 Google Ads'te görünüyorsa röntgen.
-- Site: Eslamed (b1264552-c859-40cb-a3fb-0ba057afd070)
-- Supabase SQL Editor'da çalıştır. Tarih aralığını ayarla: '1 day' veya '12 hours'
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) LOST CONVERSIONS: Bugün oluşturulan tüm queue kayıtları
--    (created_at = bugün)
-- -----------------------------------------------------------------------------
SELECT
  oq.id AS queue_id,
  oq.call_id,
  oq.status AS queue_status,
  oq.value_cents,
  oq.currency,
  oq.gclid,
  oq.wbraid,
  oq.gbraid,
  oq.session_id,
  oq.created_at,
  oq.updated_at,
  oq.uploaded_at,
  oq.provider_request_id,
  oq.provider_error_code,
  oq.provider_error_category,
  oq.last_error,
  oq.attempt_count,
  c.confirmed_at AS muhur_zamani,
  c.lead_score,
  c.sale_amount
FROM offline_conversion_queue oq
LEFT JOIN calls c ON c.id = oq.call_id AND c.site_id = oq.site_id
WHERE oq.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
  AND oq.created_at >= (CURRENT_DATE AT TIME ZONE 'Europe/Istanbul')::date
ORDER BY oq.created_at DESC;


-- -----------------------------------------------------------------------------
-- 2) SUCCESS CONFIRMATION: COMPLETED kayıtlar + partial failure / warning bilgisi
--    last_error ve provider_error_code partial_failure mesajlarını içerebilir
-- -----------------------------------------------------------------------------
SELECT
  oq.id AS queue_id,
  oq.call_id,
  oq.status,
  oq.value_cents / 100.0 AS deger_birim,
  oq.uploaded_at AS google_a_gonderim_zamani,
  oq.provider_request_id,
  oq.provider_error_code,
  oq.provider_error_category,
  oq.last_error AS partial_failure_veya_hata_mesaji,
  oq.gclid,
  oq.wbraid,
  oq.gbraid
FROM offline_conversion_queue oq
WHERE oq.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
  AND oq.created_at >= (CURRENT_DATE AT TIME ZONE 'Europe/Istanbul')::date
  AND oq.status = 'COMPLETED'
ORDER BY oq.uploaded_at DESC;


-- -----------------------------------------------------------------------------
-- 3) QUEUED / RETRY / FAILED: Neden worker temizlememiş?
--    (QUEUED = henüz claim edilmedi; RETRY/FAILED = hata döndü)
-- -----------------------------------------------------------------------------
SELECT
  oq.id AS queue_id,
  oq.status,
  oq.attempt_count,
  oq.provider_error_code,
  oq.provider_error_category,
  oq.last_error,
  oq.created_at,
  oq.updated_at,
  CASE
    WHEN oq.status = 'QUEUED' THEN 'Worker henüz claim etmedi veya cron çalışmadı'
    WHEN oq.status = 'RETRY' THEN 'Geçici hata; worker tekrar deneyecek'
    WHEN oq.status = 'FAILED' THEN 'Kalıcı hata; manuel müdahale gerekebilir'
    ELSE 'Bilinmiyor'
  END AS muhtemel_aciklama
FROM offline_conversion_queue oq
WHERE oq.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
  AND oq.created_at >= (CURRENT_DATE AT TIME ZONE 'Europe/Istanbul')::date
  AND oq.status IN ('QUEUED', 'RETRY', 'FAILED', 'PROCESSING')
ORDER BY oq.created_at DESC;


-- -----------------------------------------------------------------------------
-- 4) VALUE SYNC AUDIT: value_cents vs call.lead_score / sale_amount
--    syncQueueValuesFromCalls bu değerleri call'tan okur; kuyrukta güncellenir
-- -----------------------------------------------------------------------------
SELECT
  oq.id AS queue_id,
  oq.call_id,
  oq.value_cents,
  oq.status,
  c.lead_score,
  c.sale_amount,
  c.currency AS call_currency,
  CASE
    WHEN oq.call_id IS NULL THEN 'sale-originated (call_id yok)'
    WHEN c.sale_amount IS NOT NULL AND c.sale_amount > 0 THEN 'sale_amount dolu → value sync uygulanır'
    WHEN c.lead_score IS NOT NULL THEN 'lead_score → star → value'
    ELSE 'default value'
  END AS value_kaynak
FROM offline_conversion_queue oq
LEFT JOIN calls c ON c.id = oq.call_id AND c.site_id = oq.site_id
WHERE oq.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
  AND oq.created_at >= (CURRENT_DATE AT TIME ZONE 'Europe/Istanbul')::date
ORDER BY oq.created_at DESC;


-- -----------------------------------------------------------------------------
-- 5) GCLID vs ATTRIBUTION TYPE: Session click_id + Non-Organic kontrolü
--    gclid / wbraid / gbraid dolu mu; session ingest sırasında Non-Organic işaretlendi mi?
-- -----------------------------------------------------------------------------
SELECT
  oq.id AS queue_id,
  oq.call_id,
  oq.gclid AS queue_gclid,
  oq.wbraid AS queue_wbraid,
  oq.gbraid AS queue_gbraid,
  s.gclid AS session_gclid,
  s.wbraid AS session_wbraid,
  s.gbraid AS session_gbraid,
  CASE
    WHEN (oq.gclid IS NOT NULL AND TRIM(oq.gclid) <> '') THEN 'gclid'
    WHEN (oq.wbraid IS NOT NULL AND TRIM(oq.wbraid) <> '') THEN 'wbraid'
    WHEN (oq.gbraid IS NOT NULL AND TRIM(oq.gbraid) <> '') THEN 'gbraid'
    ELSE 'click_id_yok'
  END AS attribution_type,
  s.consent_scopes @> ARRAY['marketing']::text[] AS has_marketing_consent
FROM offline_conversion_queue oq
LEFT JOIN calls c ON c.id = oq.call_id AND c.site_id = oq.site_id
LEFT JOIN sessions s ON s.id = c.matched_session_id AND s.site_id = c.site_id
WHERE oq.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
  AND oq.created_at >= (CURRENT_DATE AT TIME ZONE 'Europe/Istanbul')::date
ORDER BY oq.created_at DESC;


-- -----------------------------------------------------------------------------
-- 6) ÖZET: Bugün kaç mühür, kaçı kuyrukta, kaçı Google'a gitti
-- -----------------------------------------------------------------------------
WITH bugun_muhur AS (
  SELECT c.id
  FROM calls c
  WHERE c.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
    AND c.status IN ('confirmed', 'qualified', 'real')
    AND c.oci_status = 'sealed'
    AND c.confirmed_at >= (CURRENT_DATE AT TIME ZONE 'Europe/Istanbul')::date
),
bugun_queue AS (
  SELECT oq.id, oq.status, oq.call_id
  FROM offline_conversion_queue oq
  WHERE oq.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
    AND oq.created_at >= (CURRENT_DATE AT TIME ZONE 'Europe/Istanbul')::date
)
SELECT
  (SELECT COUNT(*) FROM bugun_muhur) AS toplam_muhur,
  (SELECT COUNT(*) FROM bugun_queue) AS kuyrukta_kayit,
  (SELECT COUNT(*) FROM bugun_queue WHERE status = 'COMPLETED') AS google_a_giden,
  (SELECT COUNT(*) FROM bugun_queue WHERE status IN ('QUEUED', 'PROCESSING')) AS bekleyen,
  (SELECT COUNT(*) FROM bugun_queue WHERE status IN ('RETRY', 'FAILED')) AS hata_tekrar,
  (SELECT COUNT(*) FROM bugun_muhur m WHERE NOT EXISTS (SELECT 1 FROM bugun_queue q WHERE q.call_id = m.id)) AS hic_kuyruga_girmeyen;

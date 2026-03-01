-- =============================================================================
-- Eslamed: Tüm gönderilebilir dönüşümleri kuyruğa ekle
-- Click ID (gclid/wbraid/gbraid) olan mühürleri kuyruğa at.
-- conversion_time = mühür zamanı (calls.confirmed_at). Seal için confirmed_at zorunlu.
-- Click ID olmayanlar Google Ads kabul etmez — onları ekleme.
-- Supabase SQL Editor'da çalıştır.
-- Site: Eslamed — b1264552-c859-40cb-a3fb-0ba057afd070
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) ÖNCE KONTROL — Hangi mühürler kuyruğa girecek, hangileri atlanacak
--    conversion_time = mühür zamanı (calls.confirmed_at)
-- -----------------------------------------------------------------------------
SELECT
  c.id AS call_id,
  c.confirmed_at AS muhur_zamani,
  c.lead_score,
  c.sale_amount,
  sess.gclid,
  sess.wbraid,
  sess.gbraid,
  CASE
    WHEN (sess.gclid IS NOT NULL AND TRIM(COALESCE(sess.gclid, '')) <> '')
      OR (sess.wbraid IS NOT NULL AND TRIM(COALESCE(sess.wbraid, '')) <> '')
      OR (sess.gbraid IS NOT NULL AND TRIM(COALESCE(sess.gbraid, '')) <> '')
    THEN 'KUYRUGA_EKLE'
    ELSE 'ATLA_ADS_ALMAZ'
  END AS aksiyon,
  oq.id AS queue_id,
  oq.status AS queue_status
FROM calls c
LEFT JOIN sessions sess ON sess.id = c.matched_session_id AND sess.site_id = c.site_id
LEFT JOIN offline_conversion_queue oq ON oq.call_id = c.id AND oq.site_id = c.site_id
WHERE c.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
  AND c.status IN ('confirmed', 'qualified', 'real')
  AND c.oci_status = 'sealed'
  AND NOT EXISTS (SELECT 1 FROM offline_conversion_queue oq2 WHERE oq2.call_id = c.id)
ORDER BY c.created_at DESC;


-- -----------------------------------------------------------------------------
-- 2) KUYRUĞA EKLE — Sadece gclid/wbraid/gbraid olan mühürleri ekle
--    conversion_time = mühür zamanı (c.confirmed_at)
--    Click ID yoksa ekleme (script MISSING_CLICK_ID ile atar, gereksiz FAILED)
-- -----------------------------------------------------------------------------
INSERT INTO offline_conversion_queue (
  site_id, call_id, sale_id, provider_key,
  conversion_time, value_cents, currency,
  gclid, wbraid, gbraid, status
)
SELECT
  c.site_id,
  c.id,
  NULL::uuid,
  'google_ads',
  c.confirmed_at,
  (CASE
    WHEN c.sale_amount IS NOT NULL AND c.sale_amount > 0 THEN ROUND(c.sale_amount * 100)::bigint
    ELSE ROUND((COALESCE(c.lead_score, 20) / 20.0) * 150 * 100)::bigint
  END),
  COALESCE(NULLIF(TRIM(c.currency), ''), 'TRY'),
  NULLIF(TRIM(sess.gclid), ''),
  NULLIF(TRIM(sess.wbraid), ''),
  NULLIF(TRIM(sess.gbraid), ''),
  'QUEUED'
FROM calls c
JOIN sessions sess ON sess.id = c.matched_session_id AND sess.site_id = c.site_id
WHERE c.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
  AND c.status IN ('confirmed', 'qualified', 'real')
  AND c.oci_status = 'sealed'
  AND (
    (sess.gclid IS NOT NULL AND TRIM(COALESCE(sess.gclid, '')) <> '')
    OR (sess.wbraid IS NOT NULL AND TRIM(COALESCE(sess.wbraid, '')) <> '')
    OR (sess.gbraid IS NOT NULL AND TRIM(COALESCE(sess.gbraid, '')) <> '')
  )
  AND NOT EXISTS (
    SELECT 1 FROM offline_conversion_queue oq
    WHERE oq.call_id = c.id
  );


-- -----------------------------------------------------------------------------
-- 3) FAILED/RETRY'ları QUEUED yap (script yeniden denesin)
-- -----------------------------------------------------------------------------
UPDATE offline_conversion_queue
SET status = 'QUEUED', claimed_at = NULL, updated_at = now()
WHERE site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
  AND status IN ('FAILED', 'RETRY');


-- -----------------------------------------------------------------------------
-- 4) PROCESSING'de takılı olanları QUEUED yap (script yeniden alsın)
-- -----------------------------------------------------------------------------
UPDATE offline_conversion_queue
SET status = 'QUEUED', claimed_at = NULL, updated_at = now()
WHERE site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
  AND status = 'PROCESSING';


-- -----------------------------------------------------------------------------
-- 5) ÖZET — Kaç eklendi, kaç atlandı (click_id yok)
-- -----------------------------------------------------------------------------
WITH sealed AS (
  SELECT c.id, c.created_at,
    (sess.gclid IS NOT NULL AND TRIM(COALESCE(sess.gclid, '')) <> '')
    OR (sess.wbraid IS NOT NULL AND TRIM(COALESCE(sess.wbraid, '')) <> '')
    OR (sess.gbraid IS NOT NULL AND TRIM(COALESCE(sess.gbraid, '')) <> '') AS has_click_id
  FROM calls c
  LEFT JOIN sessions sess ON sess.id = c.matched_session_id AND sess.site_id = c.site_id
  WHERE c.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
    AND c.status IN ('confirmed', 'qualified', 'real')
    AND c.oci_status = 'sealed'
),
queued AS (
  SELECT oq.call_id FROM offline_conversion_queue oq
  WHERE oq.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
)
SELECT
  (SELECT COUNT(*) FROM sealed s WHERE s.has_click_id AND NOT EXISTS (SELECT 1 FROM queued q WHERE q.call_id = s.id)) AS eklenecek_gonderilebilir,
  (SELECT COUNT(*) FROM sealed s WHERE NOT s.has_click_id) AS atlanacak_click_id_yok,
  (SELECT COUNT(*) FROM offline_conversion_queue oq WHERE oq.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070' AND oq.status = 'QUEUED') AS kuyrukta_bekleyen;


-- -----------------------------------------------------------------------------
-- 6) SISTEM TESTI — COMPLETED'leri QUEUED yap, tekrar gönder
--    Google zaten aldıysa duplicate hatası / ignor; almadıysa bu sefer gider.
--    Sprint sonrası akış doğrulama için kullan.
-- -----------------------------------------------------------------------------
-- Sadece bugünkü COMPLETED satırları resetle (test için)
UPDATE offline_conversion_queue
SET status = 'QUEUED', claimed_at = NULL, uploaded_at = NULL, updated_at = now()
WHERE site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
  AND status = 'COMPLETED'
  AND created_at::date = current_date;


-- -----------------------------------------------------------------------------
-- 7) ESKİ GCLID'LER — Önizleme (son 90 gün, kuyrukta olmayan, gclid var)
--    Google Ads OCI: tıklama tarihinden itibaren ~90 gün kabul eder
-- -----------------------------------------------------------------------------
SELECT
  c.id AS call_id,
  c.confirmed_at AS muhur_zamani,
  sess.gclid,
  sess.wbraid,
  sess.gbraid
FROM calls c
JOIN sessions sess ON sess.id = c.matched_session_id AND sess.site_id = c.site_id
WHERE c.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
  AND c.status IN ('confirmed', 'qualified', 'real')
  AND c.oci_status = 'sealed'
  AND c.created_at >= CURRENT_DATE - INTERVAL '90 days'
  AND c.created_at < CURRENT_DATE
  AND (
    (sess.gclid IS NOT NULL AND TRIM(COALESCE(sess.gclid, '')) <> '')
    OR (sess.wbraid IS NOT NULL AND TRIM(COALESCE(sess.wbraid, '')) <> '')
    OR (sess.gbraid IS NOT NULL AND TRIM(COALESCE(sess.gbraid, '')) <> '')
  )
  AND NOT EXISTS (SELECT 1 FROM offline_conversion_queue oq WHERE oq.call_id = c.id)
ORDER BY c.created_at DESC;


-- -----------------------------------------------------------------------------
-- 8) ESKİ GCLID'LERİ KUYRUĞA EKLE — Son 90 gün, gclid olan, kuyrukta olmayan
--    conversion_time = mühür zamanı (c.confirmed_at)
-- -----------------------------------------------------------------------------
INSERT INTO offline_conversion_queue (
  site_id, call_id, sale_id, provider_key,
  conversion_time, value_cents, currency,
  gclid, wbraid, gbraid, status
)
SELECT
  c.site_id,
  c.id,
  NULL::uuid,
  'google_ads',
  c.confirmed_at,
  (CASE
    WHEN c.sale_amount IS NOT NULL AND c.sale_amount > 0 THEN ROUND(c.sale_amount * 100)::bigint
    ELSE ROUND((COALESCE(c.lead_score, 20) / 20.0) * 150 * 100)::bigint
  END),
  COALESCE(NULLIF(TRIM(c.currency), ''), 'TRY'),
  NULLIF(TRIM(sess.gclid), ''),
  NULLIF(TRIM(sess.wbraid), ''),
  NULLIF(TRIM(sess.gbraid), ''),
  'QUEUED'
FROM calls c
JOIN sessions sess ON sess.id = c.matched_session_id AND sess.site_id = c.site_id
WHERE c.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
  AND c.status IN ('confirmed', 'qualified', 'real')
  AND c.oci_status = 'sealed'
  AND c.created_at >= CURRENT_DATE - INTERVAL '90 days'
  AND c.created_at < CURRENT_DATE
  AND (
    (sess.gclid IS NOT NULL AND TRIM(COALESCE(sess.gclid, '')) <> '')
    OR (sess.wbraid IS NOT NULL AND TRIM(COALESCE(sess.wbraid, '')) <> '')
    OR (sess.gbraid IS NOT NULL AND TRIM(COALESCE(sess.gbraid, '')) <> '')
  )
  AND NOT EXISTS (SELECT 1 FROM offline_conversion_queue oq WHERE oq.call_id = c.id);


-- -----------------------------------------------------------------------------
-- Kullanım
-- -----------------------------------------------------------------------------
-- 1) Sorgu 1 → Hangi mühürler eklenecek, hangileri atlanacak (önizleme)
-- 2) Sorgu 2 (INSERT) → Tüm gönderilebilir dönüşümleri kuyruğa ekle (conversion_time = mühür)
-- 3) Sorgu 3 (UPDATE) → FAILED/RETRY'ları QUEUED yap
-- 4) Sorgu 4 (UPDATE) → Takılı PROCESSING'leri QUEUED yap
-- 5) Sorgu 5 → Özet
-- 6) Sorgu 6 (UPDATE) → SISTEM TESTI: Bugünkü COMPLETED'leri QUEUED yap
-- 7) Sorgu 7 → ESKİ GCLID önizleme (son 90 gün, kuyrukta olmayan)
-- 8) Sorgu 8 (INSERT) → ESKİ GCLID'leri kuyruğa ekle (son 90 gün)
-- 9) Google Ads Script çalıştır

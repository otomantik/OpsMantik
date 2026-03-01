-- =============================================================================
-- Eslamed + Muratcan: Bugünkü intent (mühürlü call) durumları ve kuyruk
-- Supabase SQL Editor'da çalıştır.
-- Eslamed: b1264552-c859-40cb-a3fb-0ba057afd070
-- Muratcan: c644fff7-9d7a-440d-b9bf-99f3a0f86073
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) BUGÜNKÜ MÜHÜR (SEALED) INTENT'LER — Her iki site, kuyruk durumu ile
-- -----------------------------------------------------------------------------
SELECT
  s.name AS site_name,
  c.id AS call_id,
  c.confirmed_at,
  c.status AS call_status,
  c.oci_status,
  c.lead_score,
  c.sale_amount,
  c.currency,
  oq.id AS queue_id,
  oq.status AS queue_status,
  oq.uploaded_at AS google_a_gitti,
  (sess.gclid IS NOT NULL AND TRIM(COALESCE(sess.gclid, '')) <> '')
   OR (sess.wbraid IS NOT NULL AND TRIM(COALESCE(sess.wbraid, '')) <> '')
   OR (sess.gbraid IS NOT NULL AND TRIM(COALESCE(sess.gbraid, '')) <> '') AS has_click_id,
  CASE
    WHEN oq.id IS NULL THEN 'kuyrukta_yok'
    WHEN oq.status = 'COMPLETED' THEN 'google_ok'
    WHEN oq.status = 'QUEUED' THEN 'bekliyor'
    WHEN oq.status = 'PROCESSING' THEN 'isleniyor'
    WHEN oq.status IN ('FAILED', 'RETRY') THEN 'hata'
    ELSE oq.status::text
  END AS durum_ozet
FROM calls c
JOIN sites s ON s.id = c.site_id
LEFT JOIN offline_conversion_queue oq ON oq.call_id = c.id AND oq.site_id = c.site_id
LEFT JOIN sessions sess ON sess.id = c.matched_session_id AND sess.site_id = c.site_id
WHERE c.site_id IN ('b1264552-c859-40cb-a3fb-0ba057afd070', 'c644fff7-9d7a-440d-b9bf-99f3a0f86073')
  AND c.status IN ('confirmed', 'qualified', 'real')
  AND c.oci_status = 'sealed'
  AND c.confirmed_at::date = current_date
ORDER BY c.site_id, c.confirmed_at DESC;


-- -----------------------------------------------------------------------------
-- 2) ÖZET — Site bazlı bugün kaç mühür, kaçı kuyrukta, kaçı Google'a gitti
-- -----------------------------------------------------------------------------
WITH sealed AS (
  SELECT c.site_id, c.id
  FROM calls c
  WHERE c.site_id IN ('b1264552-c859-40cb-a3fb-0ba057afd070', 'c644fff7-9d7a-440d-b9bf-99f3a0f86073')
    AND c.status IN ('confirmed', 'qualified', 'real')
    AND c.oci_status = 'sealed'
    AND c.confirmed_at::date = current_date
),
queue AS (
  SELECT oq.site_id, oq.call_id, oq.status
  FROM offline_conversion_queue oq
  WHERE oq.site_id IN ('b1264552-c859-40cb-a3fb-0ba057afd070', 'c644fff7-9d7a-440d-b9bf-99f3a0f86073')
    AND oq.call_id IS NOT NULL
)
SELECT
  st.name AS site,
  (SELECT COUNT(*) FROM sealed s WHERE s.site_id = st.id) AS bugun_toplam_muhur,
  (SELECT COUNT(*) FROM sealed s JOIN queue q ON q.call_id = s.id AND q.site_id = s.site_id WHERE s.site_id = st.id) AS kuyrukta_olan,
  (SELECT COUNT(*) FROM sealed s JOIN queue q ON q.call_id = s.id AND q.site_id = s.site_id AND q.status = 'COMPLETED' WHERE s.site_id = st.id) AS google_a_giden,
  (SELECT COUNT(*) FROM sealed s WHERE s.site_id = st.id AND NOT EXISTS (SELECT 1 FROM queue q WHERE q.call_id = s.id)) AS kuyruga_girmeyen
FROM sites st
WHERE st.id IN ('b1264552-c859-40cb-a3fb-0ba057afd070', 'c644fff7-9d7a-440d-b9bf-99f3a0f86073');


-- -----------------------------------------------------------------------------
-- 3) KUYRUĞA GİRMEYEN MÜHÜRLER — Click ID var mı? (varsa eklenebilir)
-- -----------------------------------------------------------------------------
SELECT
  s.name AS site_name,
  c.id AS call_id,
  c.confirmed_at,
  c.lead_score,
  c.sale_amount,
  (sess.gclid IS NOT NULL AND TRIM(COALESCE(sess.gclid, '')) <> '')
   OR (sess.wbraid IS NOT NULL AND TRIM(COALESCE(sess.wbraid, '')) <> '')
   OR (sess.gbraid IS NOT NULL AND TRIM(COALESCE(sess.gbraid, '')) <> '') AS has_click_id,
  sess.gclid,
  sess.wbraid,
  sess.gbraid,
  sess.consent_scopes @> ARRAY['marketing']::text[] AS has_marketing_consent
FROM calls c
JOIN sites s ON s.id = c.site_id
LEFT JOIN sessions sess ON sess.id = c.matched_session_id AND sess.site_id = c.site_id
WHERE c.site_id IN ('b1264552-c859-40cb-a3fb-0ba057afd070', 'c644fff7-9d7a-440d-b9bf-99f3a0f86073')
  AND c.status IN ('confirmed', 'qualified', 'real')
  AND c.oci_status = 'sealed'
  AND c.confirmed_at::date = current_date
  AND NOT EXISTS (
    SELECT 1 FROM offline_conversion_queue oq
    WHERE oq.call_id = c.id
  )
ORDER BY c.site_id, c.confirmed_at DESC;


-- -----------------------------------------------------------------------------
-- 4) KUYRUĞA EKLE — Kuyrukta olmayan bugünkü mühürleri ekle
--    Click ID yoksa satır eklenir ama script atlar; click ID varsa Google'a gider.
--    Bu INSERT'i çalıştırmadan önce sorgu 3'te has_click_id true olanları kontrol et.
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
LEFT JOIN sessions sess ON sess.id = c.matched_session_id AND sess.site_id = c.site_id
WHERE c.site_id IN ('b1264552-c859-40cb-a3fb-0ba057afd070', 'c644fff7-9d7a-440d-b9bf-99f3a0f86073')
  AND c.status IN ('confirmed', 'qualified', 'real')
  AND c.oci_status = 'sealed'
  AND c.confirmed_at::date = current_date
  AND NOT EXISTS (
    SELECT 1 FROM offline_conversion_queue oq
    WHERE oq.call_id = c.id
  );


-- -----------------------------------------------------------------------------
-- 5) PROCESSING'de takılı olanları QUEUED yap (script yeniden çeksin)
-- -----------------------------------------------------------------------------
UPDATE offline_conversion_queue
SET status = 'QUEUED', claimed_at = NULL, updated_at = now()
WHERE site_id IN ('b1264552-c859-40cb-a3fb-0ba057afd070', 'c644fff7-9d7a-440d-b9bf-99f3a0f86073')
  AND status = 'PROCESSING';


-- -----------------------------------------------------------------------------
-- Kullanım sırası
-- -----------------------------------------------------------------------------
-- 1) Sorgu 1 → Bugünkü tüm mühürler + kuyruk durumu
-- 2) Sorgu 2 → Özet (kaç mühür, kaçı kuyrukta, kaçı Google'a gitti)
-- 3) Sorgu 3 → Kuyruğa girmeyenler (has_click_id true ise eklenebilir)
-- 4) Sorgu 4 (INSERT) → Eksikleri kuyruğa ekle
-- 5) Sorgu 5 (UPDATE) → Takılı PROCESSING'leri QUEUED yap
-- 6) Google Ads Script çalıştır → Google'a gitsin

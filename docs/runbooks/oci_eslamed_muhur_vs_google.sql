-- =============================================================================
-- Eslamed: Mühürlenen intent'ler vs Google'a gidenler — karşılaştırma
-- Site: b1264552-c859-40cb-a3fb-0ba057afd070
-- Supabase SQL Editor'da çalıştır.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Tüm mühürlü (sealed) call'lar + kuyruk durumu + neden gitmemiş olabilir
--    Son 6 saat. İstersen: '6 hours' → '1 day' / '30 days'
-- -----------------------------------------------------------------------------
SELECT
  c.id AS call_id,
  c.confirmed_at,
  c.lead_score,
  c.sale_amount,
  c.currency,
  -- Kuyrukta var mı, Google'a gitti mi?
  oq.id AS queue_id,
  oq.status AS queue_status,
  oq.uploaded_at AS google_a_gonderim_tarihi,
  CASE
    WHEN oq.id IS NULL THEN 'GİTMEDİ (kuyrukta yok)'
    WHEN oq.status = 'COMPLETED' THEN 'Google''a gitti'
    WHEN oq.status = 'QUEUED' THEN 'Kuyrukta bekliyor'
    WHEN oq.status = 'PROCESSING' THEN 'İşleniyor'
    WHEN oq.status IN ('FAILED', 'RETRY') THEN 'Hata / Tekrar'
    ELSE oq.status::text
  END AS durum_ozet,
  -- Neden gitmemiş olabilir (kuyrukta yoksa)
  (s.gclid IS NOT NULL AND TRIM(COALESCE(s.gclid, '')) <> '')
   OR (s.wbraid IS NOT NULL AND TRIM(COALESCE(s.wbraid, '')) <> '')
   OR (s.gbraid IS NOT NULL AND TRIM(COALESCE(s.gbraid, '')) <> '') AS has_click_id,
  (s.consent_scopes @> ARRAY['marketing']::text[]) AS has_marketing_consent
FROM calls c
LEFT JOIN offline_conversion_queue oq
  ON oq.call_id = c.id AND oq.site_id = c.site_id
LEFT JOIN sessions s ON s.id = c.matched_session_id AND s.site_id = c.site_id
WHERE c.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
  AND c.status IN ('confirmed', 'qualified', 'real')
  AND c.oci_status = 'sealed'
  AND c.confirmed_at >= (now() - interval '6 hours')
ORDER BY c.confirmed_at DESC;


-- -----------------------------------------------------------------------------
-- 2) Özet: Son 6 saatte kaç mühür, kaçı kuyrukta, kaçı Google'a gitti, kaçı hiç gitmedi
-- -----------------------------------------------------------------------------
WITH sealed AS (
  SELECT c.id
  FROM calls c
  WHERE c.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
    AND c.status IN ('confirmed', 'qualified', 'real')
    AND c.oci_status = 'sealed'
    AND c.confirmed_at >= (now() - interval '6 hours')
),
in_queue AS (
  SELECT oq.call_id, oq.status
  FROM offline_conversion_queue oq
  WHERE oq.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
    AND oq.call_id IS NOT NULL
)
SELECT
  (SELECT COUNT(*) FROM sealed) AS toplam_muhur,
  (SELECT COUNT(*) FROM sealed s JOIN in_queue q ON q.call_id = s.id) AS kuyrukta_olan,
  (SELECT COUNT(*) FROM sealed s JOIN in_queue q ON q.call_id = s.id WHERE q.status = 'COMPLETED') AS google_a_giden,
  (SELECT COUNT(*) FROM sealed s WHERE NOT EXISTS (SELECT 1 FROM in_queue q WHERE q.call_id = s.id)) AS hic_kuyruga_girmeyen;


-- -----------------------------------------------------------------------------
-- 3) Son 6 saatte gitmeyen mühürler (neden: click_id / consent eksik olabilir)
-- -----------------------------------------------------------------------------
SELECT
  c.id AS call_id,
  c.confirmed_at,
  c.lead_score,
  (s.gclid IS NOT NULL AND TRIM(COALESCE(s.gclid, '')) <> '')
   OR (s.wbraid IS NOT NULL AND TRIM(COALESCE(s.wbraid, '')) <> '')
   OR (s.gbraid IS NOT NULL AND TRIM(COALESCE(s.gbraid, '')) <> '') AS has_click_id,
  (s.consent_scopes @> ARRAY['marketing']::text[]) AS has_marketing_consent,
  CASE
    WHEN (s.gclid IS NULL OR TRIM(COALESCE(s.gclid, '')) = '')
     AND (s.wbraid IS NULL OR TRIM(COALESCE(s.wbraid, '')) = '')
     AND (s.gbraid IS NULL OR TRIM(COALESCE(s.gbraid, '')) = '')
    THEN 'click_id_yok'
    WHEN NOT (s.consent_scopes @> ARRAY['marketing']::text[])
    THEN 'marketing_consent_yok'
    ELSE 'diger'
  END AS muhtemel_neden
FROM calls c
LEFT JOIN sessions s ON s.id = c.matched_session_id AND s.site_id = c.site_id
WHERE c.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
  AND c.status IN ('confirmed', 'qualified', 'real')
  AND c.oci_status = 'sealed'
  AND c.confirmed_at >= (now() - interval '6 hours')
  AND NOT EXISTS (
    SELECT 1 FROM offline_conversion_queue oq
    WHERE oq.call_id = c.id
  )
ORDER BY c.confirmed_at DESC;

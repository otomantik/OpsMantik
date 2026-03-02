-- =============================================================================
-- Eslamed: Bugünkü akış — Mühür, kuyruk, Google'a gönderim
-- Ne alemde, ne seçilmiş, görüşüldü mü, mühür vurulmuş mu?
-- Site: Eslamed (b1264552-c859-40cb-a3fb-0ba057afd070)
-- Supabase SQL Editor'da çalıştır. Tarih: current_date (İstanbul saatine göre bugün).
-- =============================================================================

-- Sabit: Eslamed site_id
-- b1264552-c859-40cb-a3fb-0ba057afd070

-- -----------------------------------------------------------------------------
-- 0) ÖZET — Bugün Eslamed: kaç mühür, kaçı kuyrukta, kaçı Google'a gitti
--    "Ne alemde": toplam mühür | kuyrukta olan | Google'a giden | kuyruğa girmeyen
-- -----------------------------------------------------------------------------
WITH bugun AS (
  SELECT (CURRENT_DATE AT TIME ZONE 'Europe/Istanbul')::date AS bugun_tarih
),
sealed_today AS (
  SELECT c.id AS call_id
  FROM calls c, bugun b
  WHERE c.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
    AND c.status IN ('confirmed', 'qualified', 'real')
    AND c.oci_status = 'sealed'
    AND c.confirmed_at::date = b.bugun_tarih
),
in_queue AS (
  SELECT oq.call_id, oq.status
  FROM offline_conversion_queue oq
  WHERE oq.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
    AND oq.call_id IS NOT NULL
)
SELECT
  (SELECT bugun_tarih FROM bugun) AS bugun,
  (SELECT COUNT(*) FROM sealed_today) AS toplam_muhur,
  (SELECT COUNT(*) FROM sealed_today s JOIN in_queue q ON q.call_id = s.call_id) AS kuyrukta_olan,
  (SELECT COUNT(*) FROM sealed_today s JOIN in_queue q ON q.call_id = s.call_id WHERE q.status = 'COMPLETED') AS google_a_giden,
  (SELECT COUNT(*) FROM sealed_today s WHERE NOT EXISTS (SELECT 1 FROM in_queue q WHERE q.call_id = s.call_id)) AS kuyruga_girmeyen;


-- -----------------------------------------------------------------------------
-- 1) BUGÜNKÜ TÜM MÜHÜRLER — Liste: mühür zamanı, kuyruk durumu, Google'a gitti mi?
--    "Mühür vurulmuş" = oci_status = 'sealed' + status in (confirmed, qualified, real)
-- -----------------------------------------------------------------------------
SELECT
  c.id AS call_id,
  c.confirmed_at AS muhur_zamani,
  c.status AS call_status,
  c.oci_status,
  c.oci_status_updated_at,
  c.lead_score,
  c.sale_amount,
  c.currency,
  oq.id AS queue_id,
  oq.status AS queue_status,
  oq.uploaded_at AS google_a_gitti_zamani,
  CASE
    WHEN oq.id IS NULL THEN 'kuyrukta_yok'
    WHEN oq.status = 'COMPLETED' THEN 'google_ok'
    WHEN oq.status = 'QUEUED' THEN 'bekliyor'
    WHEN oq.status = 'PROCESSING' THEN 'isleniyor'
    WHEN oq.status IN ('FAILED', 'RETRY') THEN 'hata_tekrar'
    ELSE oq.status::text
  END AS durum_ozet
FROM calls c
LEFT JOIN offline_conversion_queue oq ON oq.call_id = c.id AND oq.site_id = c.site_id
WHERE c.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
  AND c.status IN ('confirmed', 'qualified', 'real')
  AND c.oci_status = 'sealed'
  AND c.confirmed_at::date = (CURRENT_DATE AT TIME ZONE 'Europe/Istanbul')::date
ORDER BY c.confirmed_at DESC;


-- -----------------------------------------------------------------------------
-- 2) SON GÖNDERİLENLER — Google'a giden (COMPLETED) kayıtlar bugün nasıl mühürlenmiş?
--    Hangi call, ne zaman mühürlendi, ne zaman kuyruğa alındı, ne zaman Google'a gitti
-- -----------------------------------------------------------------------------
SELECT
  oq.id AS queue_id,
  oq.call_id,
  oq.status AS queue_status,
  oq.uploaded_at AS google_a_gonderim_zamani,
  oq.value_cents,
  oq.currency,
  oq.gclid,
  c.confirmed_at AS muhur_zamani,
  c.oci_status,
  c.oci_status_updated_at AS muhur_guncelleme,
  c.lead_score,
  c.sale_amount
FROM offline_conversion_queue oq
JOIN calls c ON c.id = oq.call_id AND c.site_id = oq.site_id
WHERE oq.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
  AND oq.status = 'COMPLETED'
  AND (oq.uploaded_at::date = (CURRENT_DATE AT TIME ZONE 'Europe/Istanbul')::date
       OR oq.updated_at::date = (CURRENT_DATE AT TIME ZONE 'Europe/Istanbul')::date)
ORDER BY oq.uploaded_at DESC NULLS LAST, oq.updated_at DESC;


-- -----------------------------------------------------------------------------
-- 3) BUGÜN KUYRUĞA GİREN TÜM KAYITLAR — Ne seçilmiş, işlendi mi?
--    created_at bugün olan queue satırları (Eslamed)
-- -----------------------------------------------------------------------------
SELECT
  oq.id AS queue_id,
  oq.call_id,
  oq.status AS queue_status,
  oq.created_at AS kuyruga_giris,
  oq.updated_at AS son_guncelleme,
  oq.uploaded_at AS google_a_gitti,
  oq.attempt_count,
  oq.last_error,
  c.confirmed_at AS muhur_zamani,
  c.oci_status AS call_oci_status
FROM offline_conversion_queue oq
LEFT JOIN calls c ON c.id = oq.call_id AND c.site_id = oq.site_id
WHERE oq.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
  AND oq.created_at::date = (CURRENT_DATE AT TIME ZONE 'Europe/Istanbul')::date
ORDER BY oq.created_at DESC;


-- -----------------------------------------------------------------------------
-- 4) MÜHÜR VAR AMA KUYRUĞA GİRMEYENLER — Görüşüldü mü / seçilmedi mi?
--    Bugün mühürlenen ama offline_conversion_queue'da kaydı olmayan call'lar
-- -----------------------------------------------------------------------------
SELECT
  c.id AS call_id,
  c.confirmed_at AS muhur_zamani,
  c.lead_score,
  c.sale_amount,
  (sess.gclid IS NOT NULL AND TRIM(COALESCE(sess.gclid, '')) <> '')
   OR (sess.wbraid IS NOT NULL AND TRIM(COALESCE(sess.wbraid, '')) <> '')
   OR (sess.gbraid IS NOT NULL AND TRIM(COALESCE(sess.gbraid, '')) <> '') AS has_click_id,
  sess.consent_scopes @> ARRAY['marketing']::text[] AS has_marketing_consent
FROM calls c
LEFT JOIN sessions sess ON sess.id = c.matched_session_id AND sess.site_id = c.site_id
WHERE c.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
  AND c.status IN ('confirmed', 'qualified', 'real')
  AND c.oci_status = 'sealed'
  AND c.confirmed_at::date = (CURRENT_DATE AT TIME ZONE 'Europe/Istanbul')::date
  AND NOT EXISTS (
    SELECT 1 FROM offline_conversion_queue oq
    WHERE oq.call_id = c.id AND oq.site_id = c.site_id
  )
ORDER BY c.confirmed_at DESC;


-- -----------------------------------------------------------------------------
-- 4b) MÜHÜRLENMİŞ DETAY — Intent'e düşenler hepsi mühürlenmiş, satış var mı?
--    "Hepsine sealed yazmış ama hiç satış yok" kontrolü: satış = sale_amount dolu
-- -----------------------------------------------------------------------------
SELECT
  c.id AS call_id,
  c.created_at AS intent_zamani,
  c.confirmed_at AS muhur_zamani,
  c.status AS call_status,
  c.oci_status,
  c.lead_score,
  c.sale_amount,
  c.estimated_value,
  c.currency,
  c.note,
  c.intent_action,
  c.intent_target,
  c.intent_page_url,
  CASE
    WHEN c.sale_amount IS NOT NULL AND c.sale_amount > 0 THEN 'SATIŞ'
    ELSE 'INTENT (satış yok)'
  END AS tip,
  oq.id AS queue_id,
  oq.status AS queue_status,
  oq.uploaded_at AS google_a_gitti
FROM calls c
LEFT JOIN offline_conversion_queue oq ON oq.call_id = c.id AND oq.site_id = c.site_id
WHERE c.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
  AND c.status IN ('confirmed', 'qualified', 'real')
  AND c.oci_status = 'sealed'
  AND c.confirmed_at::date = (CURRENT_DATE AT TIME ZONE 'Europe/Istanbul')::date
ORDER BY c.confirmed_at DESC;


-- Özet: Kaçı satış, kaçı sadece intent?
-- -----------------------------------------------------------------------------
SELECT
  CASE
    WHEN c.sale_amount IS NOT NULL AND c.sale_amount > 0 THEN 'SATIŞ'
    ELSE 'INTENT (satış yok)'
  END AS tip,
  COUNT(*) AS adet
FROM calls c
WHERE c.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
  AND c.status IN ('confirmed', 'qualified', 'real')
  AND c.oci_status = 'sealed'
  AND c.confirmed_at::date = (CURRENT_DATE AT TIME ZONE 'Europe/Istanbul')::date
GROUP BY 1;


-- -----------------------------------------------------------------------------
-- 5) IRON SEAL / conversions tablosu (v5) — Varsa seal_status = 'sealed' dönüşümler
--    Sadece bu tablo kullanılıyorsa: conversions.seal_status = 'sealed' olanlar gönderilir
-- -----------------------------------------------------------------------------
-- Not: Eslamed akışı şu an calls + offline_conversion_queue ile; conversions tablosu
--      farklı pipeline için (get_pending_conversions_for_worker). Eslamed OCI için
--      yukarıdaki sorgular yeterli. conversions kullanımı varsa aşağıyı aç:
/*
SELECT
  cv.id,
  cv.site_id,
  cv.seal_status,
  cv.created_at,
  cv.updated_at
FROM conversions cv
WHERE cv.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
  AND cv.created_at::date = (CURRENT_DATE AT TIME ZONE 'Europe/Istanbul')::date
ORDER BY cv.created_at DESC;
*/

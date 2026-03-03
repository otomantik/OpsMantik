-- =============================================================================
-- Muratcan AKÜ — Bugünkü tüm durum (tek rapor)
-- Supabase SQL Editor'da çalıştır. Tüm blokları sırayla çalıştırabilirsin.
-- Site: Muratcan AKÜ (c644fff7-9d7a-440d-b9bf-99f3a0f86073)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0) SİTE BİLGİSİ
-- -----------------------------------------------------------------------------
SELECT
  id,
  name AS site_name,
  domain,
  public_id,
  oci_sync_method,
  created_at::date AS created
FROM sites
WHERE id = 'c644fff7-9d7a-440d-b9bf-99f3a0f86073';


-- -----------------------------------------------------------------------------
-- 1) BUGÜNKÜ SESSION SAYISI
-- -----------------------------------------------------------------------------
SELECT
  COUNT(*) AS bugun_session_sayisi,
  COUNT(*) FILTER (WHERE (gclid IS NOT NULL AND TRIM(COALESCE(gclid,'')) <> '')
    OR (wbraid IS NOT NULL AND TRIM(COALESCE(wbraid,'')) <> '')
    OR (gbraid IS NOT NULL AND TRIM(COALESCE(gbraid,'')) <> '')) AS gclid_wbraid_gbraid_olan
FROM sessions
WHERE site_id = 'c644fff7-9d7a-440d-b9bf-99f3a0f86073'
  AND created_at::date = current_date;


-- -----------------------------------------------------------------------------
-- 2) BUGÜNKÜ CALL DURUM DAĞILIMI (status bazlı)
-- -----------------------------------------------------------------------------
SELECT
  status AS call_status,
  COUNT(*) AS adet
FROM calls
WHERE site_id = 'c644fff7-9d7a-440d-b9bf-99f3a0f86073'
  AND matched_at::date = current_date
GROUP BY status
ORDER BY adet DESC;


-- -----------------------------------------------------------------------------
-- 3) BUGÜNKÜ MÜHÜR (SEALED) + KUYRUK DURUMU — Detay
-- -----------------------------------------------------------------------------
SELECT
  c.id AS call_id,
  c.matched_at,
  c.confirmed_at,
  c.status AS call_status,
  c.oci_status,
  c.lead_score,
  c.sale_amount AS satis_tl,
  c.currency,
  oq.id AS queue_id,
  oq.status AS queue_status,
  oq.value_cents,
  ROUND(oq.value_cents::numeric / 100, 2) AS google_value_tl,
  oq.uploaded_at AS google_upload_at,
  oq.retry_count,
  oq.last_error,
  (sess.gclid IS NOT NULL AND TRIM(COALESCE(sess.gclid,'')) <> '')
   OR (sess.wbraid IS NOT NULL AND TRIM(COALESCE(sess.wbraid,'')) <> '')
   OR (sess.gbraid IS NOT NULL AND TRIM(COALESCE(sess.gbraid,'')) <> '') AS has_click_id
FROM calls c
LEFT JOIN offline_conversion_queue oq ON oq.call_id = c.id AND oq.site_id = c.site_id AND oq.provider_key = 'google_ads'
LEFT JOIN sessions sess ON sess.id = c.matched_session_id AND sess.site_id = c.site_id
WHERE c.site_id = 'c644fff7-9d7a-440d-b9bf-99f3a0f86073'
  AND c.status IN ('confirmed', 'qualified', 'real')
  AND c.oci_status = 'sealed'
  AND (c.confirmed_at::date = current_date OR c.matched_at::date = current_date)
ORDER BY COALESCE(c.confirmed_at, c.matched_at) DESC;


-- -----------------------------------------------------------------------------
-- 4) ÖZET — Bugünkü mühür sayıları ve kuyruk özeti
-- -----------------------------------------------------------------------------
WITH bugun_sealed AS (
  SELECT c.id
  FROM calls c
  WHERE c.site_id = 'c644fff7-9d7a-440d-b9bf-99f3a0f86073'
    AND c.status IN ('confirmed', 'qualified', 'real')
    AND c.oci_status = 'sealed'
    AND (c.confirmed_at::date = current_date OR c.matched_at::date = current_date)
),
q AS (
  SELECT oq.call_id, oq.status
  FROM offline_conversion_queue oq
  WHERE oq.site_id = 'c644fff7-9d7a-440d-b9bf-99f3a0f86073'
    AND oq.call_id IN (SELECT id FROM bugun_sealed)
)
SELECT
  (SELECT COUNT(*) FROM bugun_sealed) AS bugun_toplam_muhur,
  (SELECT COUNT(*) FROM bugun_sealed b JOIN q ON q.call_id = b.id) AS kuyrukta_kayit_var,
  (SELECT COUNT(*) FROM bugun_sealed b JOIN q ON q.call_id = b.id AND q.status = 'COMPLETED') AS google_a_giden,
  (SELECT COUNT(*) FROM bugun_sealed b JOIN q ON q.call_id = b.id AND q.status = 'QUEUED') AS kuyrukta_bekliyor,
  (SELECT COUNT(*) FROM bugun_sealed b JOIN q ON q.call_id = b.id AND q.status = 'PROCESSING') AS isleniyor,
  (SELECT COUNT(*) FROM bugun_sealed b JOIN q ON q.call_id = b.id AND q.status IN ('FAILED','RETRY')) AS hata_veya_retry,
  (SELECT COUNT(*) FROM bugun_sealed b WHERE NOT EXISTS (SELECT 1 FROM q WHERE q.call_id = b.id)) AS kuyruga_hic_girmemis;


-- -----------------------------------------------------------------------------
-- 5) KUYRUK TABLOSU — Bugün eklenen / güncellenen tüm satırlar (Muratcan)
-- -----------------------------------------------------------------------------
SELECT
  oq.id AS queue_id,
  oq.call_id,
  oq.status AS queue_status,
  oq.conversion_time,
  oq.value_cents,
  ROUND(oq.value_cents::numeric / 100, 2) AS value_tl,
  oq.currency,
  oq.gclid,
  oq.retry_count,
  oq.next_retry_at,
  oq.uploaded_at AS google_upload_at,
  LEFT(oq.last_error, 200) AS last_error,
  oq.provider_error_code,
  oq.created_at,
  oq.updated_at
FROM offline_conversion_queue oq
WHERE oq.site_id = 'c644fff7-9d7a-440d-b9bf-99f3a0f86073'
  AND (oq.created_at::date = current_date OR oq.updated_at::date = current_date)
ORDER BY oq.updated_at DESC, oq.created_at DESC;


-- -----------------------------------------------------------------------------
-- 6) FAILED / RETRY SATIRLAR — Hata mesajları (bugün güncellenen)
-- -----------------------------------------------------------------------------
SELECT
  oq.id,
  oq.call_id,
  oq.status,
  oq.retry_count,
  oq.next_retry_at,
  oq.last_error,
  oq.provider_error_code,
  oq.provider_error_category,
  oq.updated_at
FROM offline_conversion_queue oq
WHERE oq.site_id = 'c644fff7-9d7a-440d-b9bf-99f3a0f86073'
  AND oq.status IN ('FAILED', 'RETRY')
  AND oq.updated_at::date = current_date
ORDER BY oq.updated_at DESC;


-- -----------------------------------------------------------------------------
-- 7) BUGÜNKÜ DEĞER ÖZETİ (TL) — Tabloda ölçülen vs Google'a giden
-- -----------------------------------------------------------------------------
WITH bugun_sealed AS (
  SELECT
    c.id,
    c.sale_amount,
    c.lead_score,
    oq.value_cents,
    oq.status AS queue_status
  FROM calls c
  LEFT JOIN offline_conversion_queue oq ON oq.call_id = c.id AND oq.site_id = c.site_id AND oq.provider_key = 'google_ads'
  WHERE c.site_id = 'c644fff7-9d7a-440d-b9bf-99f3a0f86073'
    AND c.status IN ('confirmed', 'qualified', 'real')
    AND c.oci_status = 'sealed'
    AND (c.confirmed_at::date = current_date OR c.matched_at::date = current_date)
)
SELECT
  COUNT(*) AS muhur_sayisi,
  ROUND(SUM(COALESCE(sale_amount, (COALESCE(lead_score, 20) / 20.0) * 150)::numeric), 2) AS tabloda_olculen_tl,
  ROUND(SUM(value_cents)::numeric / 100, 2) AS google_a_giden_tl_toplam,
  COUNT(*) FILTER (WHERE sale_amount IS NOT NULL AND sale_amount > 0) AS gercek_satis_sayisi,
  COUNT(*) FILTER (WHERE queue_status = 'COMPLETED') AS google_a_basarili_giden
FROM bugun_sealed;


-- -----------------------------------------------------------------------------
-- 8) BUGÜNKÜ MÜHÜRÜN KUYRUK SATIRINI QUEUED YAP (Google'a tekrar gitsin)
--    Başarıyla gitmemiş (COMPLETED değil) satırları QUEUED + retry sıfırla
-- -----------------------------------------------------------------------------
-- not: next_retry_at NOT NULL; hemen claim edilsin diye geçmiş zaman veriyoruz
UPDATE offline_conversion_queue oq
SET
  status         = 'QUEUED',
  next_retry_at  = now() - interval '1 minute',
  retry_count    = 0,
  last_error     = NULL,
  provider_error_code = NULL,
  provider_error_category = NULL,
  claimed_at     = NULL,
  updated_at     = now()
FROM calls c
WHERE oq.site_id = 'c644fff7-9d7a-440d-b9bf-99f3a0f86073'
  AND oq.call_id = c.id
  AND oq.provider_key = 'google_ads'
  AND oq.status <> 'COMPLETED'
  AND c.site_id = oq.site_id
  AND c.status IN ('confirmed', 'qualified', 'real')
  AND c.oci_status = 'sealed'
  AND (c.confirmed_at::date = current_date OR c.matched_at::date = current_date);
-- Kaç satır güncellendi görmek için: yukarıdaki UPDATE'ten sonra "ROW_COUNT" veya
-- aşağıdaki SELECT ile kontrol et (güncellemeden önce çalıştır = etkilenecek satırlar)
-- SELECT oq.id, oq.call_id, oq.status FROM offline_conversion_queue oq
-- JOIN calls c ON c.id = oq.call_id AND c.site_id = oq.site_id
-- WHERE oq.site_id = 'c644fff7-9d7a-440d-b9bf-99f3a0f86073' AND oq.provider_key = 'google_ads'
--   AND oq.status <> 'COMPLETED' AND (c.confirmed_at::date = current_date OR c.matched_at::date = current_date);


-- -----------------------------------------------------------------------------
-- Kullanım: Yukarıdaki blokları sırayla Supabase SQL Editor'da çalıştır.
-- 0 = Site bilgisi
-- 1 = Bugün session sayısı
-- 2 = Call status dağılımı
-- 3 = Mühür detay + kuyruk
-- 4 = Özet (tek satır)
-- 5 = Kuyruk tablosu bugün
-- 6 = FAILED/RETRY hatalar
-- 7 = Değer özeti (TL)
-- 8 = Bugünkü mühürün kuyruk satırını QUEUED yap (tekrar gönderim için)
-- =============================================================================

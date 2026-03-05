-- =============================================================================
-- Eslamed: Kuyruktaki intent'ler — Saldırı / sahte tıklama şüphesi analizi
-- Müşteri: "Kuyrukta onca data var ama reelde kimse aramadı, WhatsApp yazmadı"
-- Bu sorgu: Şüpheli (bot/tekrarlı/sahte) intent'leri işaretler.
-- Site: b1264552-c859-40cb-a3fb-0ba057afd070
-- Supabase SQL Editor'da çalıştır.
--
-- NEDEN ŞÜPHELİ ALGILANDI? (5 kriter — biri bile sağlansa suspekt = true)
-- 1) flag_3sn_alti_kalis   : Sitede 3 saniye veya daha az kalınmış (girip hemen tıklamış → bot/script)
-- 2) flag_tek_etkilesim    : Sadece 1 event var (sadece o tıklama, başka sayfa/scroll yok → gerçek kullanıcı değil)
-- 3) flag_proxy            : Oturum proxy/VPN üzerinden (anonim/saldırı trafiği)
-- 4) flag_ayni_fp_cok_intent: Aynı parmak izinden (aynı tarayıcı/cihaz) 3’ten fazla intent (tek “kullanıcı” çok tıklıyor)
-- 5) flag_ayni_ip_cok_intent: Aynı IP’den 5’ten fazla intent (aynı kaynak çok tıklama)
-- İlk sorgudaki satırlara bakarak hangi bayrakların true olduğunu görebilirsin.
-- =============================================================================

-- Son 7 gün kuyruk (status = intent veya NULL, source = click)
WITH date_range AS (
  SELECT
    (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Istanbul' - INTERVAL '7 days') AS t_from
),
base AS (
  SELECT
    c.id AS call_id,
    c.created_at,
    c.intent_action,
    c.matched_session_id,
    s.fingerprint,
    s.ip_address::text AS ip_address,
    s.total_duration_sec,
    s.event_count,
    s.is_proxy_detected,
    s.attribution_source,
    s.entry_page
  FROM public.calls c
  LEFT JOIN public.sessions s ON s.id = c.matched_session_id AND s.site_id = c.site_id
  CROSS JOIN date_range dr
  WHERE c.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
    AND c.source = 'click'
    AND (c.status = 'intent' OR c.status IS NULL)
    AND c.created_at >= dr.t_from
),
with_counts AS (
  SELECT
    base.*,
    COUNT(*) OVER (PARTITION BY base.fingerprint) AS ayni_fingerprint_intent_sayisi,
    COUNT(*) OVER (PARTITION BY base.ip_address) AS ayni_ip_intent_sayisi
  FROM base
)
SELECT
  call_id,
  created_at,
  intent_action,
  total_duration_sec,
  event_count,
  is_proxy_detected,
  attribution_source,
  ayni_fingerprint_intent_sayisi,
  ayni_ip_intent_sayisi,
  -- Şüphe bayrakları (dashboard’daki High Risk ile uyumlu + saldırı göstergeleri)
  (total_duration_sec IS NOT NULL AND total_duration_sec <= 3) AS flag_3sn_alti_kalis,
  (event_count IS NOT NULL AND event_count <= 1) AS flag_tek_etkilesim,
  (is_proxy_detected = true) AS flag_proxy,
  (ayni_fingerprint_intent_sayisi > 3) AS flag_ayni_fp_cok_intent,
  (ayni_ip_intent_sayisi > 5) AS flag_ayni_ip_cok_intent,
  (
    (total_duration_sec IS NOT NULL AND total_duration_sec <= 3)
    OR (event_count IS NOT NULL AND event_count <= 1)
    OR (is_proxy_detected = true)
    OR (ayni_fingerprint_intent_sayisi > 3)
    OR (ayni_ip_intent_sayisi > 5)
  ) AS suspekt
FROM with_counts
ORDER BY suspekt DESC, created_at DESC;


-- -----------------------------------------------------------------------------
-- ÖZET: Kaç intent şüpheli, kaçı temiz?
-- -----------------------------------------------------------------------------
WITH date_range AS (
  SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Istanbul' - INTERVAL '7 days') AS t_from
),
base AS (
  SELECT
    c.id,
    c.matched_session_id,
    s.fingerprint,
    s.ip_address,
    s.total_duration_sec,
    s.event_count,
    s.is_proxy_detected
  FROM public.calls c
  LEFT JOIN public.sessions s ON s.id = c.matched_session_id AND s.site_id = c.site_id
  CROSS JOIN date_range dr
  WHERE c.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
    AND c.source = 'click'
    AND (c.status = 'intent' OR c.status IS NULL)
    AND c.created_at >= dr.t_from
),
with_counts AS (
  SELECT
    base.*,
    COUNT(*) OVER (PARTITION BY base.fingerprint) AS fp_count,
    COUNT(*) OVER (PARTITION BY base.ip_address) AS ip_count
  FROM base
),
flagged AS (
  SELECT
    (total_duration_sec IS NOT NULL AND total_duration_sec <= 3)
    OR (event_count IS NOT NULL AND event_count <= 1)
    OR (is_proxy_detected = true)
    OR (fp_count > 3)
    OR (ip_count > 5) AS suspekt
  FROM with_counts
)
SELECT
  COUNT(*) FILTER (WHERE suspekt) AS suspekt_intent_sayisi,
  COUNT(*) FILTER (WHERE NOT suspekt) AS temiz_intent_sayisi,
  COUNT(*) AS toplam
FROM flagged;


-- -----------------------------------------------------------------------------
-- 2b) TAM ANALİZ: Her kriter kaç intent’i karşılıyor, kaçını (sadece o yüzden) şüpheli yapıyor?
--     kac_karsiladi = bu bayrak true olan intent sayısı
--     sadece_bu_yuzunden = şüpheli olup da sadece bu bayrak true (diğerleri false) olan intent sayısı
-- -----------------------------------------------------------------------------
WITH date_range AS (
  SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Istanbul' - INTERVAL '7 days') AS t_from
),
base AS (
  SELECT
    c.id,
    c.matched_session_id,
    s.fingerprint,
    s.ip_address,
    s.total_duration_sec,
    s.event_count,
    s.is_proxy_detected
  FROM public.calls c
  LEFT JOIN public.sessions s ON s.id = c.matched_session_id AND s.site_id = c.site_id
  CROSS JOIN date_range dr
  WHERE c.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
    AND c.source = 'click'
    AND (c.status = 'intent' OR c.status IS NULL)
    AND c.created_at >= dr.t_from
),
with_counts AS (
  SELECT
    base.*,
    COUNT(*) OVER (PARTITION BY base.fingerprint) AS fp_count,
    COUNT(*) OVER (PARTITION BY base.ip_address) AS ip_count
  FROM base
),
row_flags AS (
  SELECT
    id,
    (total_duration_sec IS NOT NULL AND total_duration_sec <= 3) AS f_3sn,
    (event_count IS NOT NULL AND event_count <= 1) AS f_tek,
    (is_proxy_detected = true) AS f_proxy,
    (fp_count > 3) AS f_fp,
    (ip_count > 5) AS f_ip,
    (
      (total_duration_sec IS NOT NULL AND total_duration_sec <= 3)
      OR (event_count IS NOT NULL AND event_count <= 1)
      OR (is_proxy_detected = true)
      OR (fp_count > 3)
      OR (ip_count > 5)
    ) AS suspekt
  FROM with_counts
)
SELECT * FROM (
  SELECT '1_3sn_alti_kalis' AS kriter, 'Sitede ≤3 sn kalış' AS aciklama,
    COUNT(*) FILTER (WHERE f_3sn) AS kac_karsiladi,
    COUNT(*) FILTER (WHERE suspekt AND f_3sn AND NOT f_tek AND NOT f_proxy AND NOT f_fp AND NOT f_ip) AS sadece_bu_yuzunden_suspekt
  FROM row_flags
  UNION ALL
  SELECT '2_tek_etkilesim', 'Sadece 1 event (tek tıklama)',
    COUNT(*) FILTER (WHERE f_tek),
    COUNT(*) FILTER (WHERE suspekt AND f_tek AND NOT f_3sn AND NOT f_proxy AND NOT f_fp AND NOT f_ip)
  FROM row_flags
  UNION ALL
  SELECT '3_proxy', 'Proxy/VPN',
    COUNT(*) FILTER (WHERE f_proxy),
    COUNT(*) FILTER (WHERE suspekt AND f_proxy AND NOT f_3sn AND NOT f_tek AND NOT f_fp AND NOT f_ip)
  FROM row_flags
  UNION ALL
  SELECT '4_ayni_fp_cok_intent', 'Aynı fingerprint >3 intent',
    COUNT(*) FILTER (WHERE f_fp),
    COUNT(*) FILTER (WHERE suspekt AND f_fp AND NOT f_3sn AND NOT f_tek AND NOT f_proxy AND NOT f_ip)
  FROM row_flags
  UNION ALL
  SELECT '5_ayni_ip_cok_intent', 'Aynı IP >5 intent',
    COUNT(*) FILTER (WHERE f_ip),
    COUNT(*) FILTER (WHERE suspekt AND f_ip AND NOT f_3sn AND NOT f_tek AND NOT f_proxy AND NOT f_fp)
  FROM row_flags
) t
ORDER BY kriter;


-- -----------------------------------------------------------------------------
-- 2c) Kaç intent birden fazla kriteri karşılıyor (overlap)
-- -----------------------------------------------------------------------------
WITH date_range AS (
  SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Istanbul' - INTERVAL '7 days') AS t_from
),
base AS (
  SELECT c.id, c.matched_session_id, s.total_duration_sec, s.event_count, s.is_proxy_detected, s.fingerprint, s.ip_address
  FROM public.calls c
  LEFT JOIN public.sessions s ON s.id = c.matched_session_id AND s.site_id = c.site_id
  CROSS JOIN date_range dr
  WHERE c.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
    AND c.source = 'click'
    AND (c.status = 'intent' OR c.status IS NULL)
    AND c.created_at >= dr.t_from
),
with_counts AS (
  SELECT base.*,
    COUNT(*) OVER (PARTITION BY base.fingerprint) AS fp_count,
    COUNT(*) OVER (PARTITION BY base.ip_address) AS ip_count
  FROM base
),
row_flags AS (
  SELECT
    (total_duration_sec IS NOT NULL AND total_duration_sec <= 3)::int +
    (event_count IS NOT NULL AND event_count <= 1)::int +
    (is_proxy_detected = true)::int +
    (fp_count > 3)::int +
    (ip_count > 5)::int AS kac_bayrak_true
  FROM with_counts
)
SELECT
  kac_bayrak_true,
  COUNT(*) AS intent_sayisi
FROM row_flags
GROUP BY kac_bayrak_true
ORDER BY kac_bayrak_true;


-- -----------------------------------------------------------------------------
-- 3) TOPLU JUNK (isteğe bağlı) — Son 7 gündeki şüpheli intent’leri junk’la
--    Önce yukarıdaki 1. sorgu ile listeyi kontrol et; onaylıysan bu UPDATE’i çalıştır.
-- -----------------------------------------------------------------------------
/*
WITH date_range AS (
  SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Istanbul' - INTERVAL '7 days') AS t_from
),
base AS (
  SELECT c.id, c.matched_session_id, s.total_duration_sec, s.event_count, s.is_proxy_detected, s.fingerprint, s.ip_address
  FROM public.calls c
  LEFT JOIN public.sessions s ON s.id = c.matched_session_id AND s.site_id = c.site_id
  CROSS JOIN date_range dr
  WHERE c.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
    AND c.source = 'click'
    AND (c.status = 'intent' OR c.status IS NULL)
    AND c.created_at >= dr.t_from
),
with_counts AS (
  SELECT base.*,
    COUNT(*) OVER (PARTITION BY base.fingerprint) AS fp_count,
    COUNT(*) OVER (PARTITION BY base.ip_address) AS ip_count
  FROM base
),
suspekt_ids AS (
  SELECT id FROM with_counts
  WHERE (total_duration_sec IS NOT NULL AND total_duration_sec <= 3)
     OR (event_count IS NOT NULL AND event_count <= 1)
     OR (is_proxy_detected = true)
     OR (fp_count > 3)
     OR (ip_count > 5)
)
UPDATE public.calls
SET status = 'junk', updated_at = now()
WHERE id IN (SELECT id FROM suspekt_ids);
*/


-- -----------------------------------------------------------------------------
-- Kullanım
-- -----------------------------------------------------------------------------
-- 1) İlk sorgu: Şüpheli intent’leri satır satır gör (hangi bayraklar true).
-- 2) Özet: Kaç şüpheli / kaç temiz.
-- 2b) Tam analiz: Her kriter kaç intent’i karşılıyor (kac_karsiladi), kaç intent sadece o kriter yüzünden şüpheli (sadece_bu_yuzunden_suspekt).
-- 2c) Overlap: Kaç intent’te 1, 2, 3, 4 veya 5 bayrak birden true (kac_bayrak_true, intent_sayisi).
-- 3) Toplu junk: 3. bloktaki UPDATE’i comment’ten çıkarıp çalıştır (önce 1. sorgu ile listeyi doğrula).
-- 4) Saldırı devam ederse: OPSMANTIK_FRAUD_FP_THRESHOLD / traffic debloat / rate-limit değerlendir.

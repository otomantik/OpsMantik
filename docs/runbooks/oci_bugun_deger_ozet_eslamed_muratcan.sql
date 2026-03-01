-- =============================================================================
-- Bugünkü demir mühür: Tabloda ne ölçülmüş, Google'a ne giden değer gitti
-- Eslamed + Muratcan. Supabase SQL Editor'da çalıştır.
-- =============================================================================
-- Değer formülü (kuyruğa girerken, 2026-03 güncelleme):
--   sale_amount dolu ve > 0 → value_cents = sale_amount * 100 (gerçek satış)
--   Görüşüldü / satış yok (sale_amount boş veya 0) → value_cents = 0
-- Google'a giden Conversion value = value_cents / 100 (TL)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) BUGÜNKÜ MÜHÜRLER: Call'daki değerler + Kuyrukta/Google'a giden değer
-- -----------------------------------------------------------------------------
SELECT
  s.name AS site_name,
  c.id AS call_id,
  c.confirmed_at,
  c.lead_score          AS call_lead_score,
  c.sale_amount         AS call_sale_amount_tl,
  c.currency            AS call_currency,
  oq.id                 AS queue_id,
  oq.status             AS queue_status,
  oq.value_cents        AS queue_value_cents,
  ROUND(oq.value_cents::numeric / 100, 2) AS google_a_giden_tl,
  oq.currency           AS queue_currency,
  oq.uploaded_at        AS google_upload_zamani,
  CASE
    WHEN c.sale_amount IS NOT NULL AND c.sale_amount > 0 THEN 'gercek_satis'
    ELSE 'lead_score_proxy'
  END AS deger_kaynagi
FROM calls c
JOIN sites s ON s.id = c.site_id
LEFT JOIN offline_conversion_queue oq ON oq.call_id = c.id AND oq.site_id = c.site_id AND oq.provider_key = 'google_ads'
WHERE c.site_id IN ('b1264552-c859-40cb-a3fb-0ba057afd070', 'c644fff7-9d7a-440d-b9bf-99f3a0f86073')
  AND c.status IN ('confirmed', 'qualified', 'real')
  AND c.oci_status = 'sealed'
  AND c.confirmed_at::date = current_date
ORDER BY s.name, c.confirmed_at DESC;


-- -----------------------------------------------------------------------------
-- 2) ÖZET: Site bazlı toplam "ölçülen" vs "Google'a giden" değer (TL)
-- -----------------------------------------------------------------------------
WITH bugun_sealed AS (
  SELECT
    c.site_id,
    c.id AS call_id,
    c.lead_score,
    c.sale_amount,
    oq.value_cents,
    oq.status AS queue_status
  FROM calls c
  LEFT JOIN offline_conversion_queue oq ON oq.call_id = c.id AND oq.site_id = c.site_id AND oq.provider_key = 'google_ads'
  WHERE c.site_id IN ('b1264552-c859-40cb-a3fb-0ba057afd070', 'c644fff7-9d7a-440d-b9bf-99f3a0f86073')
    AND c.status IN ('confirmed', 'qualified', 'real')
    AND c.oci_status = 'sealed'
    AND c.confirmed_at::date = current_date
)
SELECT
  st.name AS site,
  COUNT(*) AS bugun_muhur_sayisi,
  ROUND(SUM(COALESCE(bs.sale_amount, (COALESCE(bs.lead_score, 20) / 20.0) * 150)::numeric), 2) AS tabloda_olculen_tl_toplam,
  ROUND(SUM(bs.value_cents)::numeric / 100, 2) AS google_a_giden_tl_toplam,
  COUNT(*) FILTER (WHERE bs.sale_amount IS NOT NULL AND bs.sale_amount > 0) AS gercek_satis_sayisi,
  COUNT(*) FILTER (WHERE bs.sale_amount IS NULL OR bs.sale_amount <= 0) AS sadece_lead_score_proxy_sayisi
FROM sites st
JOIN bugun_sealed bs ON bs.site_id = st.id
WHERE st.id IN ('b1264552-c859-40cb-a3fb-0ba057afd070', 'c644fff7-9d7a-440d-b9bf-99f3a0f86073')
GROUP BY st.id, st.name;


-- -----------------------------------------------------------------------------
-- 3) Sadece lead_score ile yüksek değer gidenler (satış girilmemiş ama Google'a yüksek TL)
--    "Satış o kadar değil" kontrolü: sale_amount boş ama value_cents yüksek
-- -----------------------------------------------------------------------------
SELECT
  s.name AS site_name,
  c.id AS call_id,
  c.confirmed_at,
  c.lead_score,
  c.sale_amount AS satis_girilmis_tl,
  ROUND(oq.value_cents::numeric / 100, 2) AS google_a_giden_tl,
  oq.status AS queue_status
FROM calls c
JOIN sites s ON s.id = c.site_id
JOIN offline_conversion_queue oq ON oq.call_id = c.id AND oq.site_id = c.site_id AND oq.provider_key = 'google_ads'
WHERE c.site_id IN ('b1264552-c859-40cb-a3fb-0ba057afd070', 'c644fff7-9d7a-440d-b9bf-99f3a0f86073')
  AND c.status IN ('confirmed', 'qualified', 'real')
  AND c.oci_status = 'sealed'
  AND c.confirmed_at::date = current_date
  AND (c.sale_amount IS NULL OR c.sale_amount <= 0)
  AND oq.value_cents > 0
ORDER BY oq.value_cents DESC;

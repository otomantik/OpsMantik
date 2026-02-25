-- =============================================================================
-- Eslamed OCI: 18:29'dan SONRA mühürlenen call'lar — kuyrukta var mı, eksikler nerede?
-- Gönderim 18:29'da yapıldı; o andan sonra girilen (sealed) kayıtlar kuyruğa düşmemiş olabilir.
-- Supabase SQL Editor'da çalıştır. Site: Eslamed (b1264552-c859-40cb-a3fb-0ba057afd070)
-- =============================================================================

-- Sabit: Eslamed site_id
-- Saat dilimi: Turkey (UTC+3). İstediğin günü/saati aşağıdaki cutoff'ta değiştir.

-- -----------------------------------------------------------------------------
-- 0) Cutoff: Gönderim anı (18:29). Bundan SONRA confirmed_at olanlar "son girenler".
--    Bugün 18:29 için: (current_date + time '18:29') AT TIME ZONE 'Europe/Istanbul'
-- -----------------------------------------------------------------------------
WITH cutoff AS (
  SELECT ((current_date) + time '18:29:00') AT TIME ZONE 'Europe/Istanbul' AS sent_at
  -- Alternatif: belirli bir gün/saat → '2025-02-25 18:29:00+03'::timestamptz
)
SELECT * FROM cutoff;
-- Bu sorguyu çalıştırıp sent_at değerini not al; aşağıdaki sorgularda kullanacağız.


-- -----------------------------------------------------------------------------
-- 1) 18:29 SONRASI sealed call'lar — hepsi (kuyrukta olan + olmayan)
--    durum = kuyrukta_yok / QUEUED / PROCESSING / SENT
-- -----------------------------------------------------------------------------
WITH cutoff AS (
  SELECT ((current_date) + time '18:29:00') AT TIME ZONE 'Europe/Istanbul' AS sent_at
)
SELECT
  c.id AS call_id,
  c.confirmed_at,
  c.oci_status,
  c.sale_amount,
  c.estimated_value,
  c.currency,
  oq.id AS queue_id,
  oq.status AS queue_status,
  oq.created_at AS queue_created_at,
  CASE
    WHEN oq.id IS NULL THEN 'kuyrukta_yok'
    ELSE oq.status
  END AS durum
FROM calls c
CROSS JOIN cutoff
LEFT JOIN offline_conversion_queue oq
  ON oq.call_id = c.id AND oq.site_id = c.site_id
WHERE c.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
  AND c.status IN ('confirmed', 'qualified', 'real')
  AND c.oci_status = 'sealed'
  AND c.confirmed_at > cutoff.sent_at
ORDER BY c.confirmed_at DESC;


-- -----------------------------------------------------------------------------
-- 2) EKSİKLER: 18:29 sonrası sealed ama kuyrukta OLMAYAN call'lar (session'da click ID var mı?)
--    Bunları kuyruğa eklemek için 3. bloktaki INSERT'i kullan.
-- -----------------------------------------------------------------------------
WITH cutoff AS (
  SELECT ((current_date) + time '18:29:00') AT TIME ZONE 'Europe/Istanbul' AS sent_at
)
SELECT
  c.id AS call_id,
  c.confirmed_at,
  c.sale_amount,
  c.estimated_value,
  c.currency,
  (s.gclid IS NOT NULL AND TRIM(COALESCE(s.gclid, '')) <> '')
   OR (s.wbraid IS NOT NULL AND TRIM(COALESCE(s.wbraid, '')) <> '')
   OR (s.gbraid IS NOT NULL AND TRIM(COALESCE(s.gbraid, '')) <> '') AS has_click_id
FROM calls c
CROSS JOIN cutoff
LEFT JOIN sessions s ON s.id = c.matched_session_id AND s.site_id = c.site_id
WHERE c.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
  AND c.status IN ('confirmed', 'qualified', 'real')
  AND c.oci_status = 'sealed'
  AND c.confirmed_at > cutoff.sent_at
  AND NOT EXISTS (
    SELECT 1 FROM offline_conversion_queue oq
    WHERE oq.call_id = c.id
  )
ORDER BY c.confirmed_at DESC;


-- -----------------------------------------------------------------------------
-- 3) Eksikleri kuyruğa ekle (2. sorguda gördüğün call_id'leri kullan)
--    call_id listesini 2. sorgu sonucuna göre doldur; yoksa tüm 18:29 sonrası eksikleri ekler.
-- -----------------------------------------------------------------------------
INSERT INTO offline_conversion_queue (
  site_id, call_id, sale_id, provider_key,
  conversion_time, value_cents, currency,
  gclid, wbraid, gbraid, status
)
SELECT
  c.site_id,
  c.id,
  NULL,
  'google_ads',
  c.confirmed_at,
  (COALESCE(c.sale_amount, c.estimated_value, 500) * 100)::bigint,
  COALESCE(NULLIF(TRIM(c.currency), ''), 'TRY'),
  NULLIF(TRIM(s.gclid), ''),
  NULLIF(TRIM(s.wbraid), ''),
  NULLIF(TRIM(s.gbraid), ''),
  'QUEUED'
FROM calls c
LEFT JOIN sessions s ON s.id = c.matched_session_id AND s.site_id = c.site_id
CROSS JOIN (SELECT ((current_date) + time '18:29:00') AT TIME ZONE 'Europe/Istanbul' AS sent_at) cutoff
WHERE c.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
  AND c.status IN ('confirmed', 'qualified', 'real')
  AND c.oci_status = 'sealed'
  AND c.confirmed_at > cutoff.sent_at
  AND NOT EXISTS (SELECT 1 FROM offline_conversion_queue oq WHERE oq.call_id = c.id);


-- -----------------------------------------------------------------------------
-- 4) Dün 18:29 kullandıysan: cutoff'u dünün saatine çek (örnek)
--    Uncomment edip sent_at'i dün 18:29 yap.
-- -----------------------------------------------------------------------------
-- WITH cutoff AS (
--   SELECT ((current_date - interval '1 day') + time '18:29:00') AT TIME ZONE 'Europe/Istanbul' AS sent_at
-- )
-- SELECT c.id, c.confirmed_at, ...
--   AND c.confirmed_at > cutoff.sent_at

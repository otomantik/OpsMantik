-- =============================================================================
-- OCI: Dünden beri mühürlenen (sealed) call'ları bul, kuyruk durumuna göre hareket et
-- Site: Eslamed (b1264552-c859-40cb-a3fb-0ba057afd070)
-- Supabase SQL Editor veya psql'de çalıştır. Başka site için 'SITE_UUID' yerine o site_id yaz.
-- =============================================================================

-- Sabit: Eslamed site_id (istersen değiştir)
-- 'b1264552-c859-40cb-a3fb-0ba057afd070'

-- -----------------------------------------------------------------------------
-- 0) Kuyruğu görelim — offline_conversion_queue (bu site)
-- -----------------------------------------------------------------------------
SELECT
  id,
  call_id,
  sale_id,
  status,
  provider_key,
  conversion_time,
  value_cents,
  currency,
  gclid IS NOT NULL OR wbraid IS NOT NULL OR gbraid IS NOT NULL AS has_click_id,
  created_at,
  claimed_at
FROM offline_conversion_queue
WHERE site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
ORDER BY created_at DESC;


-- -----------------------------------------------------------------------------
-- 1) Dünden bugüne mühürlenen call'lar + kuyrukta mı, durumu ne?
--    (4 bekleyen olmalı dediğin liste bu; toplam kaç sealed var görürsün)
-- -----------------------------------------------------------------------------
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
LEFT JOIN offline_conversion_queue oq
  ON oq.call_id = c.id AND oq.site_id = c.site_id
WHERE c.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
  AND c.status IN ('confirmed', 'qualified', 'real')
  AND c.oci_status = 'sealed'
  AND c.confirmed_at >= (current_date - interval '1 day')
  AND c.confirmed_at <= now()
ORDER BY c.confirmed_at DESC;


-- -----------------------------------------------------------------------------
-- 2) Kuyrukta olmayan sealed call'lar (session'da click ID var mı?)
--    Bunları kuyruğa ekleyebiliriz; click ID yoksa zaten Google'a gönderilemez
-- -----------------------------------------------------------------------------
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
LEFT JOIN sessions s ON s.id = c.matched_session_id AND s.site_id = c.site_id
WHERE c.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
  AND c.status IN ('confirmed', 'qualified', 'real')
  AND c.oci_status = 'sealed'
  AND c.confirmed_at >= (current_date - interval '1 day')
  AND c.confirmed_at <= now()
  AND NOT EXISTS (
    SELECT 1 FROM offline_conversion_queue oq
    WHERE oq.call_id = c.id
  )
ORDER BY c.confirmed_at DESC;


-- -----------------------------------------------------------------------------
-- 3) PROCESSING'de takılı olanları tekrar QUEUED yap (script tekrar çeksin)
-- -----------------------------------------------------------------------------
UPDATE offline_conversion_queue
SET status = 'QUEUED', claimed_at = NULL, updated_at = now()
WHERE site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
  AND status = 'PROCESSING';


-- -----------------------------------------------------------------------------
-- 4) Kuyrukta olmayan 3 sealed call'ı kuyruğa ekle (session'dan gclid/wbraid/gbraid varsa doldur)
--    Click ID yoksa satır yine eklenir; script o satırı "no click id" diye atlar ama kuyrukta görünür.
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
WHERE c.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
  AND c.id IN (
    '98823c87-d756-4f1b-b8d7-d15321a86aaa',
    '0e804e9f-d6b7-44cd-9432-dd93ed7fe965',
    'edad6c32-f6a8-40f9-bced-612c477dddf7'
  )
  AND NOT EXISTS (SELECT 1 FROM offline_conversion_queue oq WHERE oq.call_id = c.id);


-- -----------------------------------------------------------------------------
-- Kullanım sırası
-- -----------------------------------------------------------------------------
-- 1) Sorgu 1'i çalıştır → Toplam kaç sealed var, kaçı kuyrukta/queued/processing gör.
-- 2) Sorgu 2'yi çalıştır → Kuyrukta olmayan sealed'ları gör; has_click_id true olanlar eklenebilir.
-- 3) Gerekirse sorgu 3'teki UPDATE'in yorumunu kaldır, çalıştır → PROCESSING'dekiler QUEUED olsun.
-- 4) Gerekirse sorgu 4'teki INSERT'in yorumunu kaldır, çalıştır → Eksikleri kuyruğa ekle.
-- 5) Script'i çalıştır → Google'a gitsin.

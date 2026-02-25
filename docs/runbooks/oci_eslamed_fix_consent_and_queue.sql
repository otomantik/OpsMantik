-- =============================================================================
-- Eslamed OCI: Session'lara marketing consent + Site bilgisi + Kuyruğa manuel insert
-- Production Supabase'te çalıştır. Tek seferlik / test amaçlı.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Site bilgisi (script'te kullanacağın siteId = public_id veya id)
-- -----------------------------------------------------------------------------
SELECT id AS site_uuid, public_id AS site_public_id, name, domain
FROM sites
WHERE id = 'b1264552-c859-40cb-a3fb-0ba057afd070';

-- Script'te siteId olarak: yukarıdaki public_id (veya id) kullan.
-- Örnek: public_id '81d957f3c7534f53b12ff305f9f07ae7' ise script aynen kalır;
--         public_id farklıysa GoogleAdsScript.js içindeki siteId'yi buna güncelle.


-- -----------------------------------------------------------------------------
-- 2) Session'lara marketing consent ekle (yeni mühürler kuyruğa düşsün)
-- -----------------------------------------------------------------------------
UPDATE sessions
SET consent_scopes = array_append(COALESCE(consent_scopes, ARRAY[]::text[]), 'marketing')
WHERE id IN (
  '5ca2b00a-dc1f-4855-9def-f667d6293fe5',
  'e3b2e5ed-910c-49aa-8054-739a6edd919c'
)
AND NOT (consent_scopes @> ARRAY['marketing']::text[]);

-- Kaç satır güncellendi kontrol (0 veya 2 beklenir)
-- SELECT * FROM sessions WHERE id IN ('5ca2b00a-dc1f-4855-9def-f667d6293fe5','e3b2e5ed-910c-49aa-8054-739a6edd919c');


-- -----------------------------------------------------------------------------
-- 3) Mevcut iki mühürlü call'ı kuyruğa ekle (script hemen 2 kayıt görsün)
--    Zaten kuyrukta varsa (aynı call_id) ekleme, duplicate olmasın.
-- -----------------------------------------------------------------------------
INSERT INTO offline_conversion_queue (
  site_id,
  call_id,
  sale_id,
  provider_key,
  conversion_time,
  value_cents,
  currency,
  gclid,
  wbraid,
  gbraid,
  status
)
SELECT
  c.site_id,
  c.id AS call_id,
  NULL::uuid AS sale_id,
  'google_ads' AS provider_key,
  c.confirmed_at AS conversion_time,
  (CASE
    WHEN c.sale_amount IS NOT NULL AND c.sale_amount > 0 THEN ROUND(c.sale_amount * 100)::bigint
    ELSE ROUND((COALESCE(c.lead_score, 20) / 20.0) * 150 * 100)::bigint
  END) AS value_cents,
  COALESCE(NULLIF(TRIM(c.currency), ''), 'TRY') AS currency,
  s.gclid,
  s.wbraid,
  s.gbraid,
  'QUEUED' AS status
FROM calls c
JOIN sessions s ON s.id = c.matched_session_id AND s.site_id = c.site_id
WHERE c.id IN (
  'f1beadc1-67e9-44fe-908f-e711ea7e6ce3',
  'e40632a8-511b-4438-be06-b295f3f546de'
)
  AND c.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
  AND c.status = 'confirmed'
  AND c.oci_status = 'sealed'
  AND NOT EXISTS (
    SELECT 1 FROM offline_conversion_queue oq
    WHERE oq.call_id = c.id
  );


-- -----------------------------------------------------------------------------
-- 4) Kuyruktaki value_cents'i intent'e göre düzelt (sale_amount > 0 ise fiyat, yoksa lead_score sentetik)
--    Enqueue mantığı: sale_amount varsa sale_amount*100; yoksa (lead_score/20)*150*100 (1 yıldız=150 TRY, 5=750 TRY)
-- -----------------------------------------------------------------------------
UPDATE offline_conversion_queue oq
SET value_cents = (
  CASE
    WHEN c.sale_amount IS NOT NULL AND c.sale_amount > 0 THEN ROUND(c.sale_amount * 100)::bigint
    ELSE ROUND((COALESCE(c.lead_score, 20) / 20.0) * 150 * 100)::bigint
  END
)
FROM calls c
WHERE oq.call_id = c.id
  AND oq.site_id = c.site_id
  AND oq.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
  AND oq.status = 'QUEUED';


-- -----------------------------------------------------------------------------
-- 5) Kontrol: Kuyrukta QUEUED kaç satır var, value_cents doğru mu?
-- -----------------------------------------------------------------------------
SELECT oq.id, oq.call_id, oq.status, oq.value_cents, oq.currency,
       c.sale_amount, c.lead_score,
       (oq.value_cents / 100.0) AS value_try
FROM offline_conversion_queue oq
JOIN calls c ON c.id = oq.call_id AND c.site_id = oq.site_id
WHERE oq.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
ORDER BY oq.created_at DESC;


-- -----------------------------------------------------------------------------
-- 6) Bu iki kaydı kuyruktan SİL — tekrar mühürleyince canlı akışla kuyruğa düşsün
--    (Marketing consent zaten session'larda; mühür → enqueue → QUEUED)
-- -----------------------------------------------------------------------------
DELETE FROM offline_conversion_queue
WHERE call_id IN (
  'f1beadc1-67e9-44fe-908f-e711ea7e6ce3',
  'e40632a8-511b-4438-be06-b295f3f546de'
)
  AND site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070';


-- -----------------------------------------------------------------------------
-- 7) Bu iki call'ı tekrar QUEUED yap (script "0 records" diyorsa; script zaten PROCESSING yaptı)
--    Çalıştır → script'i tekrar çalıştır → 2 conversion gelir.
-- -----------------------------------------------------------------------------
UPDATE offline_conversion_queue
SET status = 'QUEUED',
    claimed_at = NULL,
    updated_at = now()
WHERE call_id IN (
  'f1beadc1-67e9-44fe-908f-e711ea7e6ce3',
  'e40632a8-511b-4438-be06-b295f3f546de'
)
  AND site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070';

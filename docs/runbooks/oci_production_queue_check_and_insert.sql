-- =============================================================================
-- Production'da kuyruk boş mu? Call/session var mı? Varsa kuyruğa ekle.
-- Aynı Supabase projesinde (console.opsmantik.com'un bağlı olduğu) çalıştır.
-- =============================================================================

-- 1) Site var mı?
SELECT '1_site' AS step, id, name, public_id FROM sites WHERE id = 'b1264552-c859-40cb-a3fb-0ba057afd070';
-- Sonuç yoksa bu projede bu site yok (farklı proje / yanlış env).

-- 2) Bu iki call bu projede var mı?
SELECT '2_calls' AS step, c.id, c.site_id, c.matched_session_id, c.status, c.oci_status
FROM calls c
WHERE c.id IN ('f1beadc1-67e9-44fe-908f-e711ea7e6ce3', 'e40632a8-511b-4438-be06-b295f3f546de')
  AND c.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070';
-- Sonuç yoksa call'lar bu DB'de yok; mühür/sync bu projede yapılmamış.

-- 3) Bu call'ların session'larında gclid var mı?
SELECT '3_sessions' AS step, s.id, s.gclid, s.wbraid, s.gbraid, s.consent_scopes
FROM sessions s
WHERE s.id IN ('5ca2b00a-dc1f-4855-9def-f667d6293fe5', 'e3b2e5ed-910c-49aa-8054-739a6edd919c')
  AND s.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070';
-- Sonuç yoksa session'lar bu projede yok.

-- 4) Kuyruğa ekle (sadece 1–3'te veri varsa satır eklenir)
INSERT INTO offline_conversion_queue (
  site_id, call_id, sale_id, provider_key, conversion_time, value_cents, currency,
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
  s.gclid,
  s.wbraid,
  s.gbraid,
  'QUEUED'
FROM calls c
JOIN sessions s ON s.id = c.matched_session_id AND s.site_id = c.site_id
WHERE c.id IN ('f1beadc1-67e9-44fe-908f-e711ea7e6ce3', 'e40632a8-511b-4438-be06-b295f3f546de')
  AND c.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
  AND c.status = 'confirmed'
  AND c.oci_status = 'sealed'
  AND NOT EXISTS (SELECT 1 FROM offline_conversion_queue oq WHERE oq.call_id = c.id);

-- 5) Kuyrukta ne var?
SELECT '5_queue' AS step, id, call_id, status, value_cents, currency
FROM offline_conversion_queue
WHERE site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
ORDER BY created_at DESC;

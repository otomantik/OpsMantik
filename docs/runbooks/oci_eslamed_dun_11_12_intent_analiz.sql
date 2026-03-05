-- =============================================================================
-- Eslamed: Dün gece 23:00–00:00 (İstanbul) intent analizi
-- 39 intent, 0 arama — Gerçek mi, halüsinasyon mu? Aynı session’a ait intent’ler?
-- Site: b1264552-c859-40cb-a3fb-0ba057afd070
-- Supabase SQL Editor'da çalıştır. Pencere: (CURRENT_DATE - 1) 23:00 → 00:00 Europe/Istanbul
-- =============================================================================

-- Zaman penceresi: dün gece 23:00 → 00:00 (gece yarısı) İstanbul
WITH tz AS (
  SELECT
    ((CURRENT_DATE AT TIME ZONE 'Europe/Istanbul') - INTERVAL '1 day')::date AS dun_tarih,
    ((((CURRENT_DATE AT TIME ZONE 'Europe/Istanbul') - INTERVAL '1 day')::date + TIME '23:00') AT TIME ZONE 'Europe/Istanbul') AS window_start,
    ((((CURRENT_DATE AT TIME ZONE 'Europe/Istanbul') - INTERVAL '1 day')::date + INTERVAL '1 day' + TIME '00:00') AT TIME ZONE 'Europe/Istanbul') AS window_end
)

-- -----------------------------------------------------------------------------
-- 0) ÖZET — Pencerede kaç intent, kaç arama (confirmed/qualified/real), kaç unique session
-- -----------------------------------------------------------------------------
SELECT
  '0_ozet' AS blok,
  tz.dun_tarih,
  tz.window_start,
  tz.window_end,
  (SELECT COUNT(*) FROM public.calls c
   CROSS JOIN tz t2
   WHERE c.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
     AND c.source = 'click'
     AND (c.status = 'intent' OR c.status IS NULL)
     AND c.created_at >= t2.window_start AND c.created_at < t2.window_end) AS toplam_intent,
  (SELECT COUNT(*) FROM public.calls c
   CROSS JOIN tz t2
   WHERE c.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
     AND c.status IN ('confirmed','qualified','real')
     AND c.created_at >= t2.window_start AND c.created_at < t2.window_end) AS toplam_arama,
  (SELECT COUNT(DISTINCT c.matched_session_id) FROM public.calls c
   CROSS JOIN tz t2
   WHERE c.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
     AND c.source = 'click'
     AND (c.status = 'intent' OR c.status IS NULL)
     AND c.created_at >= t2.window_start AND c.created_at < t2.window_end
     AND c.matched_session_id IS NOT NULL) AS unique_session_intent,
  (SELECT COUNT(*) FROM public.calls c
   CROSS JOIN tz t2
   WHERE c.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
     AND c.source = 'click'
     AND (c.status = 'intent' OR c.status IS NULL)
     AND c.created_at >= t2.window_start AND c.created_at < t2.window_end
     AND c.matched_session_id IS NULL) AS intent_session_yok
FROM tz;


-- -----------------------------------------------------------------------------
-- 1) TÜM INTENT KAYITLARI (calls) — Dün gece 23–00, session ve zaman bilgisi
-- -----------------------------------------------------------------------------
SELECT
  '1_intent_liste' AS blok,
  c.id AS call_id,
  c.created_at,
  c.matched_session_id AS session_id,
  c.status AS call_status,
  c.intent_action,
  c.intent_target,
  c.intent_stamp,
  s.entry_page,
  s.gclid,
  s.event_count AS session_event_count,
  s.total_duration_sec
FROM public.calls c
CROSS JOIN (SELECT dun_tarih, window_start, window_end FROM (
  SELECT
    ((CURRENT_DATE AT TIME ZONE 'Europe/Istanbul') - INTERVAL '1 day')::date AS dun_tarih,
    (((CURRENT_DATE AT TIME ZONE 'Europe/Istanbul') - INTERVAL '1 day')::date + TIME '23:00') AT TIME ZONE 'Europe/Istanbul' AS window_start,
    (((CURRENT_DATE AT TIME ZONE 'Europe/Istanbul') - INTERVAL '1 day')::date + INTERVAL '1 day' + TIME '00:00') AT TIME ZONE 'Europe/Istanbul' AS window_end
) x) tz
LEFT JOIN public.sessions s ON s.id = c.matched_session_id AND s.site_id = c.site_id
WHERE c.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
  AND c.source = 'click'
  AND (c.status = 'intent' OR c.status IS NULL)
  AND c.created_at >= tz.window_start
  AND c.created_at < tz.window_end
ORDER BY c.matched_session_id, c.created_at;


-- -----------------------------------------------------------------------------
-- 2) SESSION BAZLI GRUPLAMA — Aynı session’a ait birden fazla intent (halüsinasyon/tekrar riski)
-- -----------------------------------------------------------------------------
WITH intent_calls AS (
  SELECT
    c.id AS call_id,
    c.created_at,
    c.matched_session_id AS session_id
  FROM public.calls c
  CROSS JOIN (
    SELECT
      (((CURRENT_DATE AT TIME ZONE 'Europe/Istanbul') - INTERVAL '1 day')::date + TIME '23:00') AT TIME ZONE 'Europe/Istanbul' AS window_start,
      (((CURRENT_DATE AT TIME ZONE 'Europe/Istanbul') - INTERVAL '1 day')::date + INTERVAL '1 day' + TIME '00:00') AT TIME ZONE 'Europe/Istanbul' AS window_end
  ) tz
  WHERE c.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
    AND c.source = 'click'
    AND (c.status = 'intent' OR c.status IS NULL)
    AND c.created_at >= tz.window_start
    AND c.created_at < tz.window_end
)
SELECT
  '2_session_grup' AS blok,
  session_id,
  COUNT(*) AS intent_sayisi,
  MIN(created_at) AS ilk_intent,
  MAX(created_at) AS son_intent,
  CASE WHEN COUNT(*) > 1 THEN 'aynı_session_tekrar' ELSE 'tek_intent' END AS notum
FROM intent_calls
GROUP BY session_id
ORDER BY intent_sayisi DESC, session_id;


-- -----------------------------------------------------------------------------
-- 3) INTENT EVENT vs CALLS KARŞILAŞTIRMASI
--    Tracker phone_call / whatsapp gönderir (call_intent değil). IntentService bu action’larla call oluşturur.
--    intent_event_actions = call_intent + phone_call, phone_click, call_click, tel_click, whatsapp, whatsapp_click, wa_click, joinchat
-- -----------------------------------------------------------------------------
WITH tz AS (
  SELECT
    (((CURRENT_DATE AT TIME ZONE 'Europe/Istanbul') - INTERVAL '1 day')::date + TIME '23:00') AT TIME ZONE 'Europe/Istanbul' AS window_start,
    (((CURRENT_DATE AT TIME ZONE 'Europe/Istanbul') - INTERVAL '1 day')::date + INTERVAL '1 day' + TIME '00:00') AT TIME ZONE 'Europe/Istanbul' AS window_end
),
intent_actions AS (
  SELECT unnest(ARRAY['call_intent','phone_call','phone_click','call_click','tel_click','whatsapp','whatsapp_click','wa_click','joinchat']) AS action
)
SELECT
  '3_event_karsilastirma' AS blok,
  (SELECT COUNT(*) FROM public.events e
   CROSS JOIN tz
   WHERE e.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
     AND e.event_action IN (SELECT action FROM intent_actions)
     AND e.created_at >= tz.window_start AND e.created_at < tz.window_end) AS intent_event_sayisi,
  (SELECT COUNT(*) FROM public.events e
   CROSS JOIN tz
   WHERE e.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
     AND e.event_action = 'call_intent'
     AND e.created_at >= tz.window_start AND e.created_at < tz.window_end) AS sadece_call_intent_event,
  (SELECT COUNT(*) FROM public.calls c
   CROSS JOIN tz
   WHERE c.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
     AND c.source = 'click'
     AND (c.status = 'intent' OR c.status IS NULL)
     AND c.created_at >= tz.window_start AND c.created_at < tz.window_end) AS calls_intent_sayisi;


-- -----------------------------------------------------------------------------
-- 4) INTENT EVENT LİSTESİ — Session bazlı (phone_call/whatsapp/call_intent vb. tüm intent action’lar)
-- -----------------------------------------------------------------------------
SELECT
  '4_event_liste' AS blok,
  e.session_id,
  e.event_action,
  COUNT(*) AS adet,
  MIN(e.created_at) AS ilk_event,
  MAX(e.created_at) AS son_event
FROM public.events e
CROSS JOIN (
  SELECT
    (((CURRENT_DATE AT TIME ZONE 'Europe/Istanbul') - INTERVAL '1 day')::date + TIME '23:00') AT TIME ZONE 'Europe/Istanbul' AS window_start,
    (((CURRENT_DATE AT TIME ZONE 'Europe/Istanbul') - INTERVAL '1 day')::date + INTERVAL '1 day' + TIME '00:00') AT TIME ZONE 'Europe/Istanbul' AS window_end
) tz
WHERE e.site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
  AND e.event_action IN ('call_intent','phone_call','phone_click','call_click','tel_click','whatsapp','whatsapp_click','wa_click','joinchat')
  AND e.created_at >= tz.window_start
  AND e.created_at < tz.window_end
GROUP BY e.session_id, e.event_action
ORDER BY adet DESC, e.session_id, e.event_action;


-- -----------------------------------------------------------------------------
-- 5) SONUÇ ÖZETİ — Yorum için
-- -----------------------------------------------------------------------------
-- - toplam_intent = 39 ve toplam_arama = 0 ise: 39 tıklama intent’i var, hiçbiri o saatte arama olarak onaylanmamış.
-- - unique_session_intent < 39 ise: Aynı session’dan birden fazla intent var (tekrarlı tıklama veya çift kayıt riski).
-- - intent_session_yok > 0 ise: Session’sız intent var (eşleşmemiş kayıt).
-- - call_intent_event_sayisi ile calls_intent_sayisi farklıysa: Event/call pipeline tutarsızlığı (gecikme veya kayıp).
-- - 2_session_grup’ta intent_sayisi > 1 olan session’lar: “Aynı session’a ait” intent’ler; saldırı/tekrar/halüsinasyon incelemesi için aday.

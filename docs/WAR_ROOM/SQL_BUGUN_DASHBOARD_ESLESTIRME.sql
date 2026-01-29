-- Bugün (TRT) telefon / WhatsApp tıklaması ve form dönüşümü — Dashboard ile eşleştirme
-- Supabase SQL Editor'da çalıştır. Site: Poyraz Antika (domain/name ile bulunuyor, UUID yazmana gerek yok).
-- Aralık: TRT bugün 00:00 – TRT yarın 00:00 (yarım açık [from, to)), ads_only = true.

-- ========== 1) Site: Poyraz Antika (poyrazantika.com) ==========
WITH site_param AS (
  SELECT id AS sid FROM sites WHERE domain ILIKE '%poyrazantika%' OR name ILIKE '%poyraz%antika%' LIMIT 1
),
-- TRT bugün aralığı (UTC)
today_range AS (
  SELECT
    (date_trunc('day', (now() AT TIME ZONE 'UTC') + interval '3 hours') - interval '3 hours') AT TIME ZONE 'UTC' AS from_utc,
    (date_trunc('day', (now() AT TIME ZONE 'UTC') + interval '3 hours') - interval '3 hours') AT TIME ZONE 'UTC' + interval '1 day' AS to_utc
)
-- ========== 2) RPC: Ads-only (dashboard ile aynı) + Tüm trafik (ads_only=false) ==========
SELECT
  'get_dashboard_stats (bugün TRT, ads_only=true)' AS aciklama,
  get_dashboard_stats(
    (SELECT sid FROM site_param),
    (SELECT from_utc FROM today_range),
    (SELECT to_utc FROM today_range),
    true
  ) AS sonuc
UNION ALL
SELECT
  'get_dashboard_stats (bugün TRT, ads_only=false — tüm trafik)' AS aciklama,
  get_dashboard_stats(
    (SELECT sid FROM site_param),
    (SELECT from_utc FROM today_range),
    (SELECT to_utc FROM today_range),
    false
  ) AS sonuc;


-- ========== 3) Sadece sayılar (phone / whatsapp / forms) — aynı SITE_ID ve today_range kullan ==========
-- Yukarıdaki site_param ve today_range ile aynı mantık; tek satırda özet.
/*
WITH site_param AS (SELECT id AS sid FROM sites WHERE domain ILIKE '%poyrazantika%' OR name ILIKE '%poyraz%antika%' LIMIT 1),
today_range AS (
  SELECT
    (date_trunc('day', (now() AT TIME ZONE 'UTC') + interval '3 hours') - interval '3 hours') AT TIME ZONE 'UTC' AS from_utc,
    (date_trunc('day', (now() AT TIME ZONE 'UTC') + interval '3 hours') - interval '3 hours') AT TIME ZONE 'UTC' + interval '1 day' AS to_utc
),
r AS (SELECT (SELECT sid FROM site_param) AS site_id, (SELECT from_utc FROM today_range) AS from_utc, (SELECT to_utc FROM today_range) AS to_utc),
v_start_month AS (SELECT date_trunc('month', r.from_utc)::date AS d FROM r),
v_end_month AS (SELECT (date_trunc('month', r.to_utc)::date + interval '1 month')::date AS d FROM r)
SELECT
  (SELECT COUNT(*)::int FROM calls c, r
   WHERE c.site_id = r.site_id
     AND c.created_at >= r.from_utc AND c.created_at < r.to_utc
     AND c.source = 'click' AND (c.status = 'intent' OR c.status IS NULL) AND c.intent_action = 'phone'
     AND EXISTS (SELECT 1 FROM sessions s, v_start_month m, v_end_month e
                 WHERE s.site_id = r.site_id AND s.id = c.matched_session_id
                   AND s.created_month >= (SELECT d FROM v_start_month) AND s.created_month < (SELECT d FROM v_end_month)
                   AND s.created_at >= r.from_utc AND s.created_at < r.to_utc
                   AND public.is_ads_session(s))) AS phone_click_intents,
  (SELECT COUNT(*)::int FROM calls c, r
   WHERE c.site_id = r.site_id
     AND c.created_at >= r.from_utc AND c.created_at < r.to_utc
     AND c.source = 'click' AND (c.status = 'intent' OR c.status IS NULL) AND c.intent_action = 'whatsapp'
     AND EXISTS (SELECT 1 FROM sessions s, v_start_month m, v_end_month e
                 WHERE s.site_id = r.site_id AND s.id = c.matched_session_id
                   AND s.created_month >= (SELECT d FROM v_start_month) AND s.created_month < (SELECT d FROM v_end_month)
                   AND s.created_at >= r.from_utc AND s.created_at < r.to_utc
                   AND public.is_ads_session(s))) AS whatsapp_click_intents,
  (SELECT COUNT(*)::int FROM events e
   JOIN sessions s ON e.session_id = s.id AND e.session_month = s.created_month
   CROSS JOIN r
   WHERE s.site_id = r.site_id
     AND e.session_month >= (SELECT d FROM v_start_month) AND e.session_month < (SELECT d FROM v_end_month)
     AND e.created_at >= r.from_utc AND e.created_at < r.to_utc
     AND e.event_category = 'conversion' AND e.event_action = 'form_submit'
     AND e.event_category != 'heartbeat'
     AND public.is_ads_session(s)) AS forms_conversion;
*/

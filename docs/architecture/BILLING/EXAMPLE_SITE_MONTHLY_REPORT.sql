-- =============================================================================
-- Örnek: Bir site için bu ayki kullanım / kazanç raporu (Supabase SQL Editor)
-- Invoice SoT = ingest_idempotency (billable = true). Fiyat bilgisi DB'de yok;
-- gelir = event_count * birim_fiyat (harici hesaplanır).
-- =============================================================================

-- 1) Site bul (isim veya domain ile; "muratcan akü" için)
WITH target_site AS (
  SELECT id, public_id, name, domain
  FROM public.sites
  WHERE name ILIKE '%muratcan%akü%'
     OR name ILIKE '%muratcan akü%'
     OR domain ILIKE '%muratcan%'
     OR domain ILIKE '%aku%'
  LIMIT 1
),

-- Bu ay (UTC)
current_month AS (
  SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM') AS ym
)

-- 2) Bu ayki billable event sayısı (fatura otoritesi)
SELECT
  s.id AS site_id,
  s.public_id,
  s.name AS site_name,
  s.domain,
  c.ym AS year_month,
  COUNT(i.id) AS billable_events_this_month
FROM target_site s
CROSS JOIN current_month c
LEFT JOIN public.ingest_idempotency i
  ON i.site_id = s.id
  AND i.year_month = c.ym
  AND i.billable = true
GROUP BY s.id, s.public_id, s.name, s.domain, c.ym;

-- 3) İstersen reconciliation snapshot (site_usage_monthly) ile birlikte
-- (reconciliation cron çalışıyorsa event_count ~ billable sayısına yakın olur)
/*
SELECT
  s.public_id,
  s.name,
  u.year_month,
  u.event_count   AS usage_snapshot_events,
  u.overage_count AS usage_snapshot_overage,
  u.last_synced_at
FROM public.sites s
JOIN public.site_usage_monthly u ON u.site_id = s.id
WHERE s.name ILIKE '%muratcan%akü%'
  AND u.year_month = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM');
*/

-- 4) Sadece billable sayı (tek satır, hızlı)
/*
SELECT COUNT(*) AS billable_events_this_month
FROM public.ingest_idempotency i
JOIN public.sites s ON s.id = i.site_id
WHERE (s.name ILIKE '%muratcan%akü%' OR s.domain ILIKE '%muratcan%')
  AND i.year_month = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM')
  AND i.billable = true;
*/

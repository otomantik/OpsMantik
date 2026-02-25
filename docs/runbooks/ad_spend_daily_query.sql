-- =============================================================================
-- ad_spend_daily: Query daily spend ingested via Google Ads webhook
-- Run in Supabase SQL Editor or psql. Eslamed site_id below; change for other tenants.
-- =============================================================================

-- Enable Google Ads Spend module for Eslamed (so dashboard shows Ad Spend widget)
-- Run once per site. Idempotent: no duplicate entry if already present.
UPDATE public.sites
SET active_modules = array_append(active_modules, 'google_ads_spend')
WHERE id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
  AND NOT (active_modules @> ARRAY['google_ads_spend']::text[]);

-- Eslamed, single day (e.g. 2026-02-25)
SELECT
  id,
  site_id,
  campaign_id,
  campaign_name,
  cost_cents,
  round(cost_cents / 100.0, 2) AS cost_tl,
  clicks,
  impressions,
  spend_date,
  updated_at
FROM public.ad_spend_daily
WHERE site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
  AND spend_date = '2026-02-25'
ORDER BY updated_at DESC;

-- =============================================================================
-- Example result (2026-02-25, first successful webhook run)
-- =============================================================================
-- [
--   {
--     "id": "8bddaa9e-5e31-4616-99d9-fb4f024895d8",
--     "site_id": "b1264552-c859-40cb-a3fb-0ba057afd070",
--     "campaign_id": "23389823683",
--     "campaign_name": "Search 21/12/2025",
--     "cost_cents": 137409,
--     "cost_tl": "1374.09",
--     "clicks": 91,
--     "impressions": 815,
--     "spend_date": "2026-02-25",
--     "updated_at": "2026-02-25 19:32:16.895+00"
--   }
-- ]

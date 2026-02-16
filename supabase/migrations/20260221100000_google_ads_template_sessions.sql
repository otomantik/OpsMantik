-- Google Ads tracking template: full URL param support for sessions.
-- Template: {lpurl}?utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&utm_adgroup={adgroupid}&...
-- Adds: utm_adgroup, device_model, ads_target_id, ads_adposition, ads_feed_item_id, loc_interest_ms, loc_physical_ms

ALTER TABLE public.sessions
ADD COLUMN IF NOT EXISTS utm_adgroup TEXT;

ALTER TABLE public.sessions
ADD COLUMN IF NOT EXISTS device_model TEXT;

ALTER TABLE public.sessions
ADD COLUMN IF NOT EXISTS ads_target_id TEXT;

ALTER TABLE public.sessions
ADD COLUMN IF NOT EXISTS ads_adposition TEXT;

ALTER TABLE public.sessions
ADD COLUMN IF NOT EXISTS ads_feed_item_id TEXT;

ALTER TABLE public.sessions
ADD COLUMN IF NOT EXISTS loc_interest_ms TEXT;

ALTER TABLE public.sessions
ADD COLUMN IF NOT EXISTS loc_physical_ms TEXT;

COMMENT ON COLUMN public.sessions.utm_adgroup IS 'Google Ads {adgroupid} from utm_adgroup';
COMMENT ON COLUMN public.sessions.device_model IS 'Google Ads {devicemodel}';
COMMENT ON COLUMN public.sessions.ads_target_id IS 'Google Ads {targetid}';
COMMENT ON COLUMN public.sessions.ads_adposition IS 'Google Ads {adposition} (ad position on page)';
COMMENT ON COLUMN public.sessions.ads_feed_item_id IS 'Google Ads {feeditemid}';
COMMENT ON COLUMN public.sessions.loc_interest_ms IS 'Google Ads {loc_interest_ms}';
COMMENT ON COLUMN public.sessions.loc_physical_ms IS 'Google Ads {loc_physical_ms}';

CREATE INDEX IF NOT EXISTS idx_sessions_utm_adgroup ON public.sessions(utm_adgroup) WHERE utm_adgroup IS NOT NULL;

-- Google Ads template: network ({network}), placement ({placement}).
-- device from URL is used to set device_type in sync when present (no extra column).

ALTER TABLE public.sessions
ADD COLUMN IF NOT EXISTS ads_network TEXT;

ALTER TABLE public.sessions
ADD COLUMN IF NOT EXISTS ads_placement TEXT;

COMMENT ON COLUMN public.sessions.ads_network IS 'Google Ads {network}: Search, Display, YouTube, etc.';
COMMENT ON COLUMN public.sessions.ads_placement IS 'Google Ads {placement}';

CREATE INDEX IF NOT EXISTS idx_sessions_ads_network ON public.sessions(ads_network) WHERE ads_network IS NOT NULL;

-- HunterCard v3 / Predator HUD: store full UTM set on sessions for attribution and UI.
-- lib/attribution extracts these from URL; sync API will persist them.

ALTER TABLE public.sessions
ADD COLUMN IF NOT EXISTS utm_source TEXT;

ALTER TABLE public.sessions
ADD COLUMN IF NOT EXISTS utm_medium TEXT;

ALTER TABLE public.sessions
ADD COLUMN IF NOT EXISTS utm_campaign TEXT;

ALTER TABLE public.sessions
ADD COLUMN IF NOT EXISTS utm_content TEXT;

COMMENT ON COLUMN public.sessions.utm_source IS 'Traffic source from utm_source (e.g. google, newsletter)';
COMMENT ON COLUMN public.sessions.utm_medium IS 'Marketing medium from utm_medium (e.g. cpc, email)';
COMMENT ON COLUMN public.sessions.utm_campaign IS 'Campaign name or ID from utm_campaign';
COMMENT ON COLUMN public.sessions.utm_content IS 'Ad/content variant from utm_content';

CREATE INDEX IF NOT EXISTS idx_sessions_utm_source ON public.sessions(utm_source) WHERE utm_source IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_utm_campaign ON public.sessions(utm_campaign) WHERE utm_campaign IS NOT NULL;

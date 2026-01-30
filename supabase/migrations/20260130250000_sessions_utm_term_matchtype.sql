-- HunterCard v3 / Predator HUD: store keyword (utm_term) and match type from Google Ads tracking.
-- Tracking template: {lpurl}?utm_term={keyword}&matchtype={matchtype}&...
-- matchtype: e=Exact, p=Phrase, b=Broad

ALTER TABLE public.sessions
ADD COLUMN IF NOT EXISTS utm_term TEXT;

ALTER TABLE public.sessions
ADD COLUMN IF NOT EXISTS matchtype TEXT;

COMMENT ON COLUMN public.sessions.utm_term IS 'Search keyword from utm_term (Google Ads {keyword})';
COMMENT ON COLUMN public.sessions.matchtype IS 'Google Ads match type: e=Exact, p=Phrase, b=Broad';

CREATE INDEX IF NOT EXISTS idx_sessions_utm_term ON public.sessions(utm_term) WHERE utm_term IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_matchtype ON public.sessions(matchtype) WHERE matchtype IS NOT NULL;

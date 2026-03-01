-- =============================================================================
-- Deterministik Geo Truth: sessions master geo alanları
-- ADS geo > IP geo; Rome/Amsterdam ghost karantina.
-- =============================================================================

-- geo_source: 'ADS' | 'IP' | 'OPERATOR' | 'UNKNOWN'
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS geo_city TEXT;

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS geo_district TEXT;

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS geo_source TEXT;

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS geo_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN public.sessions.geo_city IS 'Master geo city. ADS (GCLID) > IP; Rome/Amsterdam = UNKNOWN.';
COMMENT ON COLUMN public.sessions.geo_district IS 'Master geo district. ADS (geo_target_id) > IP.';
COMMENT ON COLUMN public.sessions.geo_source IS 'ADS | IP | OPERATOR | UNKNOWN. ADS always wins.';
COMMENT ON COLUMN public.sessions.geo_updated_at IS 'Last geo update timestamp.';

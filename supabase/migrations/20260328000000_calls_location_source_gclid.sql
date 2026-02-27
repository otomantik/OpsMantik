-- GCLID-first geo: location_source on calls so dashboard can show "Source: GCLID" when location is from AdsContext.
-- When AdsContext has geo_target_id or location_name, we set district_name and location_source = 'gclid'.
-- UI prefers this over session (IP-derived) city/district to fix Rome/Amsterdam vs Istanbul discrepancy.

ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS location_source TEXT;

COMMENT ON COLUMN public.calls.location_source IS 'gclid when location (district_name) is from Google Ads context; null when from IP/session.';

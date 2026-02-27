-- Migration: Expand ValueTrack Metadata columns in calls table
-- support for: network, device, campaign_id, adgroup_id, creative_id, placement, target_id

ALTER TABLE public.calls
ADD COLUMN IF NOT EXISTS network TEXT,
ADD COLUMN IF NOT EXISTS device TEXT,
ADD COLUMN IF NOT EXISTS campaign_id BIGINT,
ADD COLUMN IF NOT EXISTS adgroup_id BIGINT,
ADD COLUMN IF NOT EXISTS creative_id BIGINT,
ADD COLUMN IF NOT EXISTS placement TEXT,
ADD COLUMN IF NOT EXISTS target_id BIGINT;

-- Add comments for clarity on the ValueTrack mapping
COMMENT ON COLUMN public.calls.network IS 'Ads network: g (search), s (search partners), v (youtube), d (display), etc.';
COMMENT ON COLUMN public.calls.device IS 'User device: m (mobile), t (tablet), c (computer).';
COMMENT ON COLUMN public.calls.campaign_id IS 'Google Ads Campaign ID.';
COMMENT ON COLUMN public.calls.adgroup_id IS 'Google Ads Ad Group ID.';
COMMENT ON COLUMN public.calls.creative_id IS 'Google Ads Ad ID (creative).';
COMMENT ON COLUMN public.calls.placement IS 'Placement URL (for Display/Search Partners).';
COMMENT ON COLUMN public.calls.target_id IS 'Target ID (location or remarketing list).';

-- Index for deep performance analysis by campaign
CREATE INDEX IF NOT EXISTS idx_calls_campaign_reporting ON public.calls (site_id, campaign_id, adgroup_id);

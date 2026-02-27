-- =============================================================================
-- Feature: Predictive Value Engine (Phase 1 Database Schema)
-- Adds baseline mathematical weights and AOV to the sites table for Google Ads smart bidding.
-- =============================================================================

BEGIN;

-- Add default_aov (Average Order Value index)
ALTER TABLE public.sites 
ADD COLUMN IF NOT EXISTS default_aov NUMERIC NOT NULL DEFAULT 100.0;

COMMENT ON COLUMN public.sites.default_aov IS 
'Average Order Value index used for calculating the dynamic Google Ads offline conversion value.';

-- Add intent_weights (Mathematical weights for different intent stages)
ALTER TABLE public.sites 
ADD COLUMN IF NOT EXISTS intent_weights JSONB NOT NULL DEFAULT '{"junk": 0.0, "pending": 0.02, "qualified": 0.20, "sealed": 1.0}'::jsonb;

COMMENT ON COLUMN public.sites.intent_weights IS 
'Mathematical weights per intent stage used for calculating the dynamic Google Ads offline conversion value.';

COMMIT;

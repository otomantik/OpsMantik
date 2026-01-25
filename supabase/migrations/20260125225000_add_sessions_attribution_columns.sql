-- Migration: Add attribution and context columns to sessions table
-- Date: 2026-01-25
-- Purpose: Store normalized attribution source and context fields for UI rendering

-- Add attribution_source column (computed source classification)
ALTER TABLE public.sessions
ADD COLUMN IF NOT EXISTS attribution_source TEXT;

-- Add device_type column (normalized: desktop/mobile/tablet)
ALTER TABLE public.sessions
ADD COLUMN IF NOT EXISTS device_type TEXT;

-- Add city column (nullable)
ALTER TABLE public.sessions
ADD COLUMN IF NOT EXISTS city TEXT;

-- Add district column (nullable)
ALTER TABLE public.sessions
ADD COLUMN IF NOT EXISTS district TEXT;

-- Add fingerprint column (nullable, for matching)
ALTER TABLE public.sessions
ADD COLUMN IF NOT EXISTS fingerprint TEXT;

-- Note: gclid column already exists in initial schema

-- Add index for attribution_source queries
CREATE INDEX IF NOT EXISTS idx_sessions_attribution_source 
ON public.sessions(attribution_source)
WHERE attribution_source IS NOT NULL;

-- Add index for device_type queries
CREATE INDEX IF NOT EXISTS idx_sessions_device_type 
ON public.sessions(device_type)
WHERE device_type IS NOT NULL;

-- Add index for fingerprint (for call matching)
CREATE INDEX IF NOT EXISTS idx_sessions_fingerprint 
ON public.sessions(fingerprint)
WHERE fingerprint IS NOT NULL;

-- Add comment
COMMENT ON COLUMN public.sessions.attribution_source IS 'Computed attribution source: First Click (Paid), Paid (UTM), Ads Assisted, Paid Social, or Organic';
COMMENT ON COLUMN public.sessions.device_type IS 'Normalized device type: desktop, mobile, or tablet';
COMMENT ON COLUMN public.sessions.city IS 'City name from geo headers or metadata';
COMMENT ON COLUMN public.sessions.district IS 'District name from geo headers or metadata';
COMMENT ON COLUMN public.sessions.fingerprint IS 'Browser fingerprint hash for session matching';

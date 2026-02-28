-- MizanMantik: Time-decayed conversion value for marketing_signals
-- Used by OCI export to send non-zero values to Google Ads (Fast-Closer Bias)
ALTER TABLE public.marketing_signals ADD COLUMN IF NOT EXISTS conversion_value NUMERIC;

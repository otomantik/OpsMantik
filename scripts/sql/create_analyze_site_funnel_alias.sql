-- Optional: create neutral RPC name for analytics funnel analysis.
-- Run in Supabase SQL editor ONLY after verifying the legacy function exists and return columns match.
--
-- 1) Inspect: SELECT * FROM public.analyze_gumus_alanlar_funnel('<site_uuid>'::uuid) LIMIT 1;
-- 2) If columns match FunnelMetrics in lib/services/analytics-service.ts, uncomment and run the block below.

/*
CREATE OR REPLACE FUNCTION public.analyze_site_funnel(target_site_id uuid)
RETURNS TABLE (
  peak_call_hour integer,
  avg_gclid_session_duration double precision,
  total_calls bigint
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT * FROM public.analyze_gumus_alanlar_funnel(target_site_id);
$$;

COMMENT ON FUNCTION public.analyze_site_funnel(uuid) IS 'Neutral alias for analyze_gumus_alanlar_funnel; see docs/architecture/adr/002-analytics-funnel-rpc-naming.md';
*/

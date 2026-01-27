-- Migration: Drop Legacy get_dashboard_stats(p_site_id, p_days)
-- Date: 2026-01-28
-- Purpose: Remove legacy function signature, only keep v2.2 contract (date_from/date_to)

-- Drop legacy function signature
DROP FUNCTION IF EXISTS public.get_dashboard_stats(uuid, int);

-- Note: The v2.2 function get_dashboard_stats(uuid, timestamptz, timestamptz) remains active
-- Migration: 20260128020000_rpc_contract_v2_2.sql

COMMENT ON FUNCTION public.get_dashboard_stats(uuid, timestamptz, timestamptz) IS 'v2.2: Dashboard stats with date_from/date_to contract. Legacy p_days signature removed.';

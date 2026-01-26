-- Migration: Fix Dashboard Stats RPC Grants
-- Date: 2026-01-27

-- Explicit grants for PostgREST access
GRANT EXECUTE ON FUNCTION public.get_dashboard_stats(uuid, int) TO anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_stats(uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_stats(uuid, int) TO service_role;

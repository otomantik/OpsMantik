-- Migration: Fix dead grant - only REVOKE/GRANT get_dashboard_stats(uuid,int) if it exists
-- Date: 2026-02-02
-- Purpose: 20260131120000 references dropped signature; guard prevents fresh-DB failure

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.proname = 'get_dashboard_stats'
      AND pg_get_function_identity_arguments(p.oid) = 'uuid, integer'
  ) THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.get_dashboard_stats(uuid, integer) FROM anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_dashboard_stats(uuid, integer) TO authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_dashboard_stats(uuid, integer) TO service_role';
  END IF;
END $$;

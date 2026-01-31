-- Migration: Secure Dashboard Stats RPC
-- Date: 2026-01-31
-- Description: Revoke anon access to dashboard stats safely using dynamic SQL.

DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_proc p 
        JOIN pg_namespace n ON p.pronamespace = n.oid 
        WHERE n.nspname = 'public' 
        AND p.proname = 'get_dashboard_stats'
    ) THEN
        BEGIN
            EXECUTE 'REVOKE EXECUTE ON FUNCTION public.get_dashboard_stats(uuid, int) FROM anon';
            EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_dashboard_stats(uuid, int) TO authenticated';
            EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_dashboard_stats(uuid, int) TO service_role';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Could not update permissions for get_dashboard_stats: %', SQLERRM;
        END;
    END IF;
END $$;

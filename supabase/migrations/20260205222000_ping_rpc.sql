-- Migration: public.ping() for safe health checks (no service-role needed)
-- Date: 2026-02-05
--
-- Purpose:
-- - Provide a minimal DB connectivity check that does not access user data
-- - Allow /api/health to use anon key only

BEGIN;

CREATE OR REPLACE FUNCTION public.ping()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 1;
$$;

REVOKE ALL ON FUNCTION public.ping() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ping() TO anon, authenticated, service_role;

COMMIT;


-- PR-4F: legacy recovery RPC grant posture hardening (defense-in-depth).
-- Keep legacy recovery semantics and compatibility path unchanged.

DO $$
BEGIN
  IF to_regprocedure('public.recover_stuck_offline_conversion_jobs(integer)') IS NULL THEN
    RAISE NOTICE 'PR-4F: recover_stuck_offline_conversion_jobs(integer) not found; skipping grant hardening.';
    RETURN;
  END IF;

  EXECUTE 'REVOKE ALL ON FUNCTION public.recover_stuck_offline_conversion_jobs(integer) FROM PUBLIC';
  EXECUTE 'REVOKE ALL ON FUNCTION public.recover_stuck_offline_conversion_jobs(integer) FROM anon';
  EXECUTE 'REVOKE ALL ON FUNCTION public.recover_stuck_offline_conversion_jobs(integer) FROM authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.recover_stuck_offline_conversion_jobs(integer) TO service_role';
END;
$$;

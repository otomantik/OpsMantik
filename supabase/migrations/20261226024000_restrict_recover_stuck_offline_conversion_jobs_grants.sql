-- PR-4F: legacy recovery RPC grant posture hardening (defense-in-depth).
-- Keep legacy recovery semantics and compatibility path unchanged.

REVOKE ALL ON FUNCTION public.recover_stuck_offline_conversion_jobs(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recover_stuck_offline_conversion_jobs(integer) FROM anon;
REVOKE ALL ON FUNCTION public.recover_stuck_offline_conversion_jobs(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.recover_stuck_offline_conversion_jobs(integer) TO service_role;

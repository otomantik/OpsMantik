-- PR-9J.8: one-shot rescue after M1-M4 are installed.

BEGIN;

SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_recovered integer := 0;
BEGIN
  SELECT public.recover_stuck_offline_conversion_jobs(30)
  INTO v_recovered;

  RAISE NOTICE 'PR-9J.8: recovered % stale PROCESSING OCI rows', COALESCE(v_recovered, 0);
END;
$$;

COMMIT;

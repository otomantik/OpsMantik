BEGIN;

-- Unify grants/security across old and new dashboard intent RPC signatures.
DO $$
BEGIN
  -- get_recent_intents_lite_v1 old signature
  IF to_regprocedure('public.get_recent_intents_lite_v1(uuid,timestamptz,timestamptz,integer,boolean)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.get_recent_intents_lite_v1(uuid,timestamptz,timestamptz,integer,boolean) SECURITY INVOKER';
    EXECUTE 'REVOKE ALL ON FUNCTION public.get_recent_intents_lite_v1(uuid,timestamptz,timestamptz,integer,boolean) FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_recent_intents_lite_v1(uuid,timestamptz,timestamptz,integer,boolean) TO authenticated, service_role';
  END IF;

  -- get_recent_intents_lite_v1 new signature
  IF to_regprocedure('public.get_recent_intents_lite_v1(uuid,timestamptz,timestamptz,integer,boolean,boolean,boolean)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.get_recent_intents_lite_v1(uuid,timestamptz,timestamptz,integer,boolean,boolean,boolean) SECURITY INVOKER';
    EXECUTE 'REVOKE ALL ON FUNCTION public.get_recent_intents_lite_v1(uuid,timestamptz,timestamptz,integer,boolean,boolean,boolean) FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_recent_intents_lite_v1(uuid,timestamptz,timestamptz,integer,boolean,boolean,boolean) TO authenticated, service_role';
  END IF;

  -- get_dashboard_intents old signature
  IF to_regprocedure('public.get_dashboard_intents(uuid,timestamptz,timestamptz,text,text,boolean)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.get_dashboard_intents(uuid,timestamptz,timestamptz,text,text,boolean) SECURITY INVOKER';
    EXECUTE 'REVOKE ALL ON FUNCTION public.get_dashboard_intents(uuid,timestamptz,timestamptz,text,text,boolean) FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_dashboard_intents(uuid,timestamptz,timestamptz,text,text,boolean) TO authenticated, service_role';
  END IF;

  -- get_dashboard_intents new signature
  IF to_regprocedure('public.get_dashboard_intents(uuid,timestamptz,timestamptz,text,text,boolean,boolean,boolean)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.get_dashboard_intents(uuid,timestamptz,timestamptz,text,text,boolean,boolean,boolean) SECURITY INVOKER';
    EXECUTE 'REVOKE ALL ON FUNCTION public.get_dashboard_intents(uuid,timestamptz,timestamptz,text,text,boolean,boolean,boolean) FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_dashboard_intents(uuid,timestamptz,timestamptz,text,text,boolean,boolean,boolean) TO authenticated, service_role';
  END IF;
END $$;

COMMIT;

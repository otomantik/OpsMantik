BEGIN;

-- 1) Final search_path hardening for overload flagged by linter.
DO $$
BEGIN
  IF to_regprocedure('public.is_ads_session()') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.is_ads_session() SET search_path = public';
  END IF;
END $$;

-- 2) Convert app-facing RPCs to SECURITY INVOKER so authenticated execution
-- does not trigger SECURITY DEFINER exposure warnings.
DO $$
BEGIN
  IF to_regprocedure('public._can_access_site(uuid)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public._can_access_site(uuid) SECURITY INVOKER';
  END IF;
  IF to_regprocedure('public.get_activity_feed_v1(uuid,integer,integer,text[])') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.get_activity_feed_v1(uuid,integer,integer,text[]) SECURITY INVOKER';
  END IF;
  IF to_regprocedure('public.get_dashboard_intents(uuid,timestamptz,timestamptz,text,text,boolean)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.get_dashboard_intents(uuid,timestamptz,timestamptz,text,text,boolean) SECURITY INVOKER';
  END IF;
  IF to_regprocedure('public.get_intent_details_v1(uuid,uuid)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.get_intent_details_v1(uuid,uuid) SECURITY INVOKER';
  END IF;
  IF to_regprocedure('public.get_kill_feed_v1(uuid,integer,integer)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.get_kill_feed_v1(uuid,integer,integer) SECURITY INVOKER';
  END IF;
  IF to_regprocedure('public.get_recent_intents_lite_v1(uuid,timestamptz,timestamptz,integer,boolean)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.get_recent_intents_lite_v1(uuid,timestamptz,timestamptz,integer,boolean) SECURITY INVOKER';
  END IF;
  IF to_regprocedure('public.get_recent_intents_v1(uuid,timestamptz,integer,integer,boolean)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.get_recent_intents_v1(uuid,timestamptz,integer,integer,boolean) SECURITY INVOKER';
  END IF;
  IF to_regprocedure('public.get_recent_intents_v2(uuid,timestamptz,timestamptz,integer,boolean)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.get_recent_intents_v2(uuid,timestamptz,timestamptz,integer,boolean) SECURITY INVOKER';
  END IF;
  IF to_regprocedure('public.get_session_details(uuid,uuid)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.get_session_details(uuid,uuid) SECURITY INVOKER';
  END IF;
  IF to_regprocedure('public.get_session_timeline(uuid,uuid,integer)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.get_session_timeline(uuid,uuid,integer) SECURITY INVOKER';
  END IF;
  IF to_regprocedure('public.is_admin()') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.is_admin() SECURITY INVOKER';
  END IF;
  IF to_regprocedure('public.undo_last_action_v1(uuid,text,uuid,jsonb)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.undo_last_action_v1(uuid,text,uuid,jsonb) SECURITY INVOKER';
  END IF;
END $$;

-- 3) Keep sensitive signature/identifier RPCs service-role only.
REVOKE ALL ON FUNCTION public.resolve_site_identifier_v1(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_site_identifier_v1(text) TO service_role;

REVOKE ALL ON FUNCTION public.verify_call_event_signature_v1(text, bigint, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_call_event_signature_v1(text, bigint, text, text) TO service_role;

-- service-only intent upsert must never be directly callable by anon/authenticated.
REVOKE ALL ON FUNCTION public.ensure_session_intent_v1(uuid, uuid, text, integer, text, text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_session_intent_v1(uuid, uuid, text, integer, text, text, text, text, text, jsonb) TO service_role;

COMMIT;

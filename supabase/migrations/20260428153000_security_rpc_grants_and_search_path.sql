BEGIN;

-- 1) Finish mutable search_path hardening with exact signatures from runtime_recovery_rpcs.
DO $$
BEGIN
  IF to_regprocedure('public.is_ads_session_input(text,text,text,text,text,text)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.is_ads_session_input(text,text,text,text,text,text) SET search_path = public';
  END IF;
  IF to_regprocedure('public.is_ads_session(public.sessions)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.is_ads_session(public.sessions) SET search_path = public';
  END IF;
END $$;

-- 2) Remove unintended anonymous EXECUTE from SECURITY DEFINER RPCs.
-- Keep authenticated/service_role access for app-facing RPCs.
REVOKE ALL ON FUNCTION public._can_access_site(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._can_access_site(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.ensure_session_intent_v1(uuid, uuid, text, integer, text, text, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_session_intent_v1(uuid, uuid, text, integer, text, text, text, text, text, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.get_activity_feed_v1(uuid, integer, integer, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_activity_feed_v1(uuid, integer, integer, text[]) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_dashboard_intents(uuid, timestamptz, timestamptz, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_intents(uuid, timestamptz, timestamptz, text, text, boolean) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_intent_details_v1(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_intent_details_v1(uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_kill_feed_v1(uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_kill_feed_v1(uuid, integer, integer) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_recent_intents_lite_v1(uuid, timestamptz, timestamptz, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_recent_intents_lite_v1(uuid, timestamptz, timestamptz, integer, boolean) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_recent_intents_v1(uuid, timestamptz, integer, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_recent_intents_v1(uuid, timestamptz, integer, integer, boolean) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_recent_intents_v2(uuid, timestamptz, timestamptz, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_recent_intents_v2(uuid, timestamptz, timestamptz, integer, boolean) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_session_details(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_session_details(uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_session_timeline(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_session_timeline(uuid, uuid, integer) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.resolve_site_identifier_v1(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_site_identifier_v1(text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.undo_last_action_v1(uuid, text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.undo_last_action_v1(uuid, text, uuid, jsonb) TO authenticated, service_role;

-- NOTE: verify_call_event_signature_v1 intentionally keeps anon execute for signed call-event v2 verification path.
-- If warning must be fully silenced, route must switch to service_role verification implementation first.

COMMIT;

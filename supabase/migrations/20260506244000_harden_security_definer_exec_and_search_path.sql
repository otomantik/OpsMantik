BEGIN;

-- Fix mutable search_path warnings on trigger/helper functions.
ALTER FUNCTION public.handle_updated_at()
  SET search_path = public;

ALTER FUNCTION public.enforce_oci_status_fsm()
  SET search_path = public;

-- Restrict SECURITY DEFINER RPC execution to service_role only.
REVOKE EXECUTE ON FUNCTION public.apply_lifecycle_mutation_v3(uuid, uuid, text, uuid, integer, integer, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_lifecycle_mutation_v3(uuid, uuid, text, uuid, integer, integer, jsonb, jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION public.calls_merge_cross_session_burst_twin_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calls_merge_cross_session_burst_twin_v1() TO service_role;

REVOKE EXECUTE ON FUNCTION public.calls_normalize_tel_uri_phone_click_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calls_normalize_tel_uri_phone_click_v1() TO service_role;

REVOKE EXECUTE ON FUNCTION public.enforce_marketing_signal_time_from_call_created_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_marketing_signal_time_from_call_created_at() TO service_role;

REVOKE EXECUTE ON FUNCTION public.enforce_oci_queue_conversion_time_from_call_created_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_oci_queue_conversion_time_from_call_created_at() TO service_role;

REVOKE EXECUTE ON FUNCTION public.watchtower_oci_health_check_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.watchtower_oci_health_check_v1() TO service_role;

COMMIT;

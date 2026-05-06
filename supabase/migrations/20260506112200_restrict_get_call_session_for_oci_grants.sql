BEGIN;

REVOKE ALL ON FUNCTION public.get_call_session_for_oci(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_call_session_for_oci(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.get_call_session_for_oci(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_call_session_for_oci(uuid, uuid) TO service_role;

COMMIT;

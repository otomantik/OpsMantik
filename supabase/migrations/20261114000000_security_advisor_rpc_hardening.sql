-- Addresses Supabase security advisor:
--   • 0011 function_search_path_mutable (compute_canonical_intent_key_v1)
--   • Reduces SECURITY DEFINER callable surface (0028/0029): revoke anon/authenticated on
--     server-contract RPCs/trigger helpers already guarded internally for service_role.
-- Auth linter "Leaked Password Protection" remains a Dashboard toggle (cannot be fixed via SQL).

BEGIN;

-- Lint 0011: stable SQL helper used by triggers/backfill
ALTER FUNCTION public.compute_canonical_intent_key_v1(uuid, uuid, text, timestamp with time zone)
SET search_path = public;

-- Session timeline RPC already enforces _can_access_site; keep DEFINER out of authenticated advisories.
ALTER FUNCTION public.get_session_timeline(uuid, uuid, integer) SECURITY INVOKER;

REVOKE ALL ON FUNCTION public.append_manual_transition_batch(
  uuid[], text, timestamptz, boolean, text, text, text
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.append_manual_transition_batch(
  uuid[], text, timestamptz, boolean, text, text, text
) FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.append_manual_transition_batch(
  uuid[], text, timestamptz, boolean, text, text, text
) TO service_role;

REVOKE ALL ON FUNCTION public.apply_snapshot_batch(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_snapshot_batch(uuid[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_snapshot_batch(uuid[]) TO service_role;

REVOKE ALL ON FUNCTION public.update_queue_status_locked(uuid[], uuid, text, boolean, text, text, text)
FROM PUBLIC;

REVOKE ALL ON FUNCTION public.update_queue_status_locked(uuid[], uuid, text, boolean, text, text, text)
FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.update_queue_status_locked(uuid[], uuid, text, boolean, text, text, text)
TO service_role;

REVOKE ALL ON FUNCTION public.calls_click_intent_stamp_canonicalize_v1 () FROM PUBLIC;
REVOKE ALL ON FUNCTION public.calls_click_intent_stamp_canonicalize_v1 () FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.calls_click_intent_stamp_canonicalize_v1 ()
TO service_role;

REVOKE ALL ON FUNCTION public.resolve_site_identifier_v1(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_site_identifier_v1(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_site_identifier_v1(text) TO service_role;

REVOKE ALL ON FUNCTION public.verify_call_event_signature_v1(text, bigint, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_call_event_signature_v1(text, bigint, text, text) FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.verify_call_event_signature_v1(text, bigint, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.apply_call_action_with_review_v1(
  uuid,
  uuid,
  text,
  uuid,
  integer,
  integer,
  jsonb,
  boolean,
  text,
  text,
  text
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.apply_call_action_with_review_v1(
  uuid,
  uuid,
  text,
  uuid,
  integer,
  integer,
  jsonb,
  boolean,
  text,
  text,
  text
) FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.apply_call_action_with_review_v1(
  uuid,
  uuid,
  text,
  uuid,
  integer,
  integer,
  jsonb,
  boolean,
  text,
  text,
  text
) TO service_role;

COMMIT;

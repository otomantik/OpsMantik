-- Supabase advisor 0028/0029: claim_outbox_events + finalize_outbox_event_v1 are worker-only (adminClient).
-- Prior migration revoked PUBLIC but Postgres/Supabase may still expose EXECUTE on anon/authenticated.

BEGIN;

REVOKE ALL ON FUNCTION public.claim_outbox_events(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_outbox_events(integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_outbox_events(integer) TO service_role;

REVOKE ALL ON FUNCTION public.finalize_outbox_event_v1(uuid, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_outbox_event_v1(uuid, text, text, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_outbox_event_v1(uuid, text, text, integer) TO service_role;

COMMIT;

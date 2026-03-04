-- Migration: Force SECURITY DEFINER on apply_call_action_v1
-- Note: A future-dated migration (20260711) redefined this RPC as SECURITY INVOKER, breaking RLS policies
-- when the backend tries to write audit logs and outbox events. This migration, dated 20261102, applies last
-- and re-establishes SECURITY DEFINER to bypass RLS.

BEGIN;

ALTER FUNCTION public.apply_call_action_v1(uuid, text, jsonb, text, uuid, jsonb, integer) SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION public.apply_call_action_v1(uuid, text, jsonb, text, uuid, jsonb, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_call_action_v1(uuid, text, jsonb, text, uuid, jsonb, integer) TO service_role;

COMMIT;

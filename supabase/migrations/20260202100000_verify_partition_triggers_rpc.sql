-- Migration: Add RPC to verify partition drift guards exist
-- Date: 2026-02-02
-- Purpose: CI/ops can call this to ensure triggers weren't dropped (prevents silent drift)

CREATE OR REPLACE FUNCTION public.verify_partition_triggers_exist()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_sessions_trigger boolean;
  v_events_trigger boolean;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'sessions'
      AND t.tgname = 'sessions_set_created_month'
      AND NOT t.tgisinternal
  ) INTO v_sessions_trigger;

  SELECT EXISTS(
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'events'
      AND t.tgname = 'events_set_session_month_from_session'
      AND NOT t.tgisinternal
  ) INTO v_events_trigger;

  RETURN v_sessions_trigger AND v_events_trigger;
END;
$$;

COMMENT ON FUNCTION public.verify_partition_triggers_exist() IS
  'CI guard: Returns true if sessions_set_created_month and events_set_session_month_from_session triggers exist. Prevents silent partition drift.';

REVOKE ALL ON FUNCTION public.verify_partition_triggers_exist() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_partition_triggers_exist() TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_partition_triggers_exist() TO authenticated;

-- Migration: Watchtower partition/trigger drift checks
-- Date: 2026-02-05
--
-- Provides:
-- - public.watchtower_checks table (append-only)
-- - public.verify_current_events_partition_exists() RPC
-- - public.watchtower_partition_drift_check_v1() RPC (inserts + returns jsonb)

BEGIN;

CREATE TABLE IF NOT EXISTS public.watchtower_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  check_name text NOT NULL,
  ok boolean NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_watchtower_checks_name_created_at
  ON public.watchtower_checks (check_name, created_at DESC);

ALTER TABLE public.watchtower_checks ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.watchtower_checks IS
  'Append-only operational health checks (partition drift, triggers, etc.). No public read policies.';

-- Verify current month events partition exists.
CREATE OR REPLACE FUNCTION public.verify_current_events_partition_exists()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_table text;
  v_month text;
  v_exists boolean;
BEGIN
  -- Align with UTC partition naming convention: events_YYYY_MM
  v_month := to_char(date_trunc('month', now() AT TIME ZONE 'utc'), 'YYYY_MM');
  v_table := 'events_' || v_month;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = v_table
  ) INTO v_exists;

  RETURN v_exists;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_current_events_partition_exists() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_current_events_partition_exists() TO service_role;

-- Combined drift check: triggers + partition.
CREATE OR REPLACE FUNCTION public.watchtower_partition_drift_check_v1()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_triggers_ok boolean;
  v_partition_ok boolean;
  v_ok boolean;
  v_details jsonb;
BEGIN
  v_triggers_ok := public.verify_partition_triggers_exist();
  v_partition_ok := public.verify_current_events_partition_exists();
  v_ok := v_triggers_ok AND v_partition_ok;

  v_details := jsonb_build_object(
    'triggers_ok', v_triggers_ok,
    'events_partition_ok', v_partition_ok,
    'checked_at', now()
  );

  INSERT INTO public.watchtower_checks (check_name, ok, details)
  VALUES ('partition_drift_v1', v_ok, v_details);

  RETURN jsonb_build_object('ok', v_ok) || v_details;
END;
$$;

REVOKE ALL ON FUNCTION public.watchtower_partition_drift_check_v1() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.watchtower_partition_drift_check_v1() TO service_role;

COMMIT;


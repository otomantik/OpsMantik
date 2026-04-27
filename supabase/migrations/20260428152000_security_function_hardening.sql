BEGIN;

-- 1) Fix mutable search_path warnings.
DO $$
BEGIN
  IF to_regprocedure('public.is_ads_session(public.sessions)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.is_ads_session(public.sessions) SET search_path = public';
  END IF;
  IF to_regprocedure('public.enforce_conversion_dispatch_state_machine()') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.enforce_conversion_dispatch_state_machine() SET search_path = public';
  END IF;
  IF to_regprocedure('public.fsm_stage_rank(text)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.fsm_stage_rank(text) SET search_path = public';
  END IF;
  IF to_regprocedure('public.enforce_lead_fsm_transition()') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.enforce_lead_fsm_transition() SET search_path = public';
  END IF;
  IF to_regprocedure('public.is_ads_session_input(text,text,text,text,text,text,text,text)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.is_ads_session_input(text,text,text,text,text,text,text,text) SET search_path = public';
  END IF;
  IF to_regprocedure('public.ops_db_now_v1()') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.ops_db_now_v1() SET search_path = public';
  END IF;
  IF to_regprocedure('public.ping()') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.ping() SET search_path = public';
  END IF;
  IF to_regprocedure('public.verify_partition_triggers_exist()') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.verify_partition_triggers_exist() SET search_path = public';
  END IF;
END $$;

-- 2) Revoke externally callable execution for service-only SECURITY DEFINER functions.
-- Keep app-facing RPCs (intent/session/dashboard/signature resolve/verify) untouched to avoid runtime breakage.
DO $$
BEGIN
  -- Billing/queue claimers
  REVOKE EXECUTE ON FUNCTION public.claim_billing_reconciliation_jobs(integer) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.claim_billing_reconciliation_jobs(integer) TO service_role;

  REVOKE EXECUTE ON FUNCTION public.claim_conversion_dispatch_batch(integer) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.claim_conversion_dispatch_batch(integer) TO service_role;

  -- Ack/idempotency internals
  REVOKE EXECUTE ON FUNCTION public.complete_ack_receipt_v1(uuid, jsonb) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.complete_ack_receipt_v1(uuid, jsonb) TO service_role;

  REVOKE EXECUTE ON FUNCTION public.register_ack_receipt_v1(uuid, text, text) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.register_ack_receipt_v1(uuid, text, text) TO service_role;

  REVOKE EXECUTE ON FUNCTION public.decrement_and_delete_idempotency(uuid, date, text, text) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.decrement_and_delete_idempotency(uuid, date, text, text) TO service_role;

  REVOKE EXECUTE ON FUNCTION public.increment_usage_checked(uuid, date, text, integer) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.increment_usage_checked(uuid, date, text, integer) TO service_role;

  -- Secrets / infra maintainers
  REVOKE EXECUTE ON FUNCTION public.rotate_site_secret_v1(text, text, text) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.rotate_site_secret_v1(text, text, text) TO service_role;

  REVOKE EXECUTE ON FUNCTION public.create_next_month_partitions() FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.create_next_month_partitions() TO service_role;

  REVOKE EXECUTE ON FUNCTION public.watchtower_partition_drift_check_v1() FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.watchtower_partition_drift_check_v1() TO service_role;

  REVOKE EXECUTE ON FUNCTION public.heartbeat_merkle_1000() FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.heartbeat_merkle_1000() TO service_role;

  REVOKE EXECUTE ON FUNCTION public.ai_pipeline_gate_checks() FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.ai_pipeline_gate_checks() TO service_role;
EXCEPTION
  WHEN undefined_function THEN
    -- Drift-safe: skip missing functions in older environments.
    NULL;
END $$;

COMMIT;

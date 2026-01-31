-- Diagnostic RPC for AI pipeline gate: pg_net, trigger, private.api_keys (no secrets returned).
-- Used by scripts/smoke/ai-pipeline-gate.mjs to verify configuration without implementing pipeline changes.

CREATE OR REPLACE FUNCTION public.ai_pipeline_gate_checks()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_catalog
AS $$
DECLARE
  v_pg_net boolean;
  v_trigger boolean;
  v_api_keys int;
BEGIN
  SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'pg_net') INTO v_pg_net;
  SELECT EXISTS(
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    WHERE c.relname = 'calls' AND t.tgname = 'calls_notify_hunter_ai'
  ) INTO v_trigger;
  SELECT count(*) INTO v_api_keys
  FROM private.api_keys
  WHERE key_name IN ('project_url', 'service_role_key');

  RETURN jsonb_build_object(
    'pg_net_enabled', v_pg_net,
    'trigger_exists', v_trigger,
    'api_keys_configured', (v_api_keys = 2)
  );
END;
$$;

COMMENT ON FUNCTION public.ai_pipeline_gate_checks() IS 'Diagnostic: AI pipeline gate (pg_net, trigger, api_keys). No secrets. Used by ai-pipeline-gate smoke.';

REVOKE ALL ON FUNCTION public.ai_pipeline_gate_checks() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_pipeline_gate_checks() TO service_role;

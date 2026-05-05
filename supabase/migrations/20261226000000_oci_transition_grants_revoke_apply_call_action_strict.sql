-- P0: Least-privilege grants on OCI ledger + helpers (service_role only).
-- P1: apply_call_action_v2 — reject unknown p_stage (no silent coercion to intent).

BEGIN;

-- ── Grants: oci ledger tables + transition RPC suite (was GRANT ALL to anon/authenticated) ──
REVOKE ALL ON TABLE public.oci_payload_validation_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.oci_queue_transitions FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.oci_payload_validation_events TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.oci_queue_transitions TO service_role;

REVOKE ALL ON FUNCTION public.oci_transition_payload_allowed_keys() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oci_transition_payload_missing_required(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oci_transition_payload_unknown_keys(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.queue_transition_clear_fields(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.queue_transition_payload_has_meaningful_patch(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.log_oci_payload_validation_event(text, uuid, uuid, text, jsonb, text[], text[], text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_snapshot_batch(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assert_latest_ledger_matches_snapshot(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_oci_queue_transition_snapshot() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.append_rpc_claim_transition_batch(uuid[], timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.append_script_claim_transition_batch(uuid[], timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.append_script_transition_batch(uuid[], text, timestamptz, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_offline_conversion_rows_for_script_export(uuid[], uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.oci_transition_payload_allowed_keys() TO service_role;
GRANT EXECUTE ON FUNCTION public.oci_transition_payload_missing_required(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.oci_transition_payload_unknown_keys(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.queue_transition_clear_fields(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.queue_transition_payload_has_meaningful_patch(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.log_oci_payload_validation_event(text, uuid, uuid, text, jsonb, text[], text[], text) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_snapshot_batch(uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.assert_latest_ledger_matches_snapshot(uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_oci_queue_transition_snapshot() TO service_role;
GRANT EXECUTE ON FUNCTION public.append_rpc_claim_transition_batch(uuid[], timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.append_script_claim_transition_batch(uuid[], timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.append_script_transition_batch(uuid[], text, timestamptz, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_offline_conversion_rows_for_script_export(uuid[], uuid) TO service_role;

-- ── Outbox pre-dedupe: at most one PENDING IntentSealed per (site, call, stage) ──
CREATE UNIQUE INDEX IF NOT EXISTS idx_outbox_events_pending_site_call_stage_uq
  ON public.outbox_events (site_id, call_id, ((payload ->> 'stage')))
  WHERE status = 'PENDING' AND event_type = 'IntentSealed';

COMMENT ON INDEX idx_outbox_events_pending_site_call_stage_uq IS
  'Pre-dedupe: one pending IntentSealed per call per payload.stage; producer treats 23505 as idempotent queued.';

-- ── apply_call_action_v2: strict stage (empty → intent; unknown → invalid_stage) ──
CREATE OR REPLACE FUNCTION public.apply_call_action_v2(
  p_call_id uuid,
  p_site_id uuid,
  p_stage text,
  p_actor_id uuid,
  p_lead_score integer DEFAULT NULL,
  p_sale_metadata jsonb DEFAULT NULL,
  p_version integer DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_caller_phone_raw text DEFAULT NULL,
  p_caller_phone_e164 text DEFAULT NULL,
  p_caller_phone_hash text DEFAULT NULL
)
RETURNS public.calls
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.calls;
  v_target_status text;
  v_merged_metadata jsonb;
  v_phone_incoming boolean;
  v_trimmed text;
BEGIN
  IF p_call_id IS NULL OR p_site_id IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'invalid_params', ERRCODE = 'P0001';
  END IF;

  SELECT *
  INTO v_row
  FROM public.calls c
  WHERE c.id = p_call_id
    AND c.site_id = p_site_id
  FOR UPDATE;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'call_not_found', ERRCODE = 'P0001';
  END IF;

  IF p_version IS NOT NULL AND coalesce(v_row.version, 0) <> p_version THEN
    RAISE EXCEPTION USING MESSAGE = 'version_conflict', ERRCODE = '40900';
  END IF;

  v_trimmed := nullif(trim(coalesce(p_stage, '')), '');
  v_target_status := lower(coalesce(v_trimmed, 'intent'));

  IF v_target_status NOT IN ('intent', 'contacted', 'offered', 'won', 'confirmed', 'junk', 'cancelled') THEN
    RAISE EXCEPTION USING
      MESSAGE = 'invalid_stage',
      DETAIL = format('unsupported stage: %s', coalesce(p_stage, '')),
      ERRCODE = 'P0001';
  END IF;

  v_merged_metadata :=
    coalesce(v_row.metadata, '{}'::jsonb)
    || coalesce(p_metadata, '{}'::jsonb)
    || jsonb_build_object(
      'stage', v_target_status,
      'actor_id', p_actor_id,
      'sale_metadata', coalesce(p_sale_metadata, '{}'::jsonb)
    );

  UPDATE public.calls c
  SET
    status = v_target_status,
    lead_score = coalesce(p_lead_score, c.lead_score),
    confirmed_at = CASE
      WHEN v_target_status IN ('won', 'confirmed') THEN coalesce(c.confirmed_at, timezone('utc', now()))
      WHEN v_target_status IN ('intent', 'junk', 'cancelled', 'contacted', 'offered') THEN NULL
      ELSE c.confirmed_at
    END,
    confirmed_by = CASE
      WHEN v_target_status IN ('won', 'confirmed') THEN coalesce(p_actor_id, c.confirmed_by)
      WHEN v_target_status IN ('intent', 'junk', 'cancelled', 'contacted', 'offered') THEN NULL
      ELSE c.confirmed_by
    END,
    metadata = v_merged_metadata,
    version = coalesce(c.version, 0) + 1
  WHERE c.id = p_call_id
    AND c.site_id = p_site_id
  RETURNING * INTO v_row;

  v_phone_incoming :=
    nullif(btrim(p_caller_phone_raw), '') IS NOT NULL
    OR nullif(btrim(p_caller_phone_e164), '') IS NOT NULL
    OR nullif(btrim(p_caller_phone_hash), '') IS NOT NULL;

  IF v_phone_incoming THEN
    PERFORM set_config('app.allow_caller_phone', '1', true);

    UPDATE public.calls c
    SET
      caller_phone_raw = coalesce(nullif(btrim(p_caller_phone_raw), ''), c.caller_phone_raw),
      caller_phone_e164 = coalesce(nullif(btrim(p_caller_phone_e164), ''), c.caller_phone_e164),
      caller_phone_hash_sha256 = coalesce(nullif(btrim(p_caller_phone_hash), ''), c.caller_phone_hash_sha256),
      phone_source_type = 'operator_verified'
    WHERE c.id = p_call_id
      AND c.site_id = p_site_id
    RETURNING * INTO v_row;
  END IF;

  RETURN v_row;
END;
$$;

COMMIT;

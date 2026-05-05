-- Forward idempotent re-assert: OCI queue transition + snapshot RPC ACLs (service_role only).
-- Rationale: partial deploys, manual GRANTs, or environments that skipped 20261226000000 must not
-- retain EXECUTE/ALL for PUBLIC, anon, or authenticated on this surface. Function bodies unchanged.

BEGIN;

REVOKE ALL ON FUNCTION public.oci_transition_payload_allowed_keys() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.oci_transition_payload_allowed_keys() FROM anon;
REVOKE ALL ON FUNCTION public.oci_transition_payload_allowed_keys() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.oci_transition_payload_allowed_keys() TO service_role;

REVOKE ALL ON FUNCTION public.oci_transition_payload_missing_required(text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.oci_transition_payload_missing_required(text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.oci_transition_payload_missing_required(text, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.oci_transition_payload_missing_required(text, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.oci_transition_payload_unknown_keys(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.oci_transition_payload_unknown_keys(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.oci_transition_payload_unknown_keys(jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.oci_transition_payload_unknown_keys(jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.queue_transition_clear_fields(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.queue_transition_clear_fields(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.queue_transition_clear_fields(jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.queue_transition_clear_fields(jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.queue_transition_payload_has_meaningful_patch(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.queue_transition_payload_has_meaningful_patch(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.queue_transition_payload_has_meaningful_patch(jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.queue_transition_payload_has_meaningful_patch(jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.log_oci_payload_validation_event(text, uuid, uuid, text, jsonb, text[], text[], text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.log_oci_payload_validation_event(text, uuid, uuid, text, jsonb, text[], text[], text) FROM anon;
REVOKE ALL ON FUNCTION public.log_oci_payload_validation_event(text, uuid, uuid, text, jsonb, text[], text[], text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.log_oci_payload_validation_event(text, uuid, uuid, text, jsonb, text[], text[], text) TO service_role;

REVOKE ALL ON FUNCTION public.apply_snapshot_batch(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_snapshot_batch(uuid[]) FROM anon;
REVOKE ALL ON FUNCTION public.apply_snapshot_batch(uuid[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.apply_snapshot_batch(uuid[]) TO service_role;

REVOKE ALL ON FUNCTION public.assert_latest_ledger_matches_snapshot(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_latest_ledger_matches_snapshot(uuid[]) FROM anon;
REVOKE ALL ON FUNCTION public.assert_latest_ledger_matches_snapshot(uuid[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.assert_latest_ledger_matches_snapshot(uuid[]) TO service_role;

REVOKE ALL ON FUNCTION public.apply_oci_queue_transition_snapshot() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_oci_queue_transition_snapshot() FROM anon;
REVOKE ALL ON FUNCTION public.apply_oci_queue_transition_snapshot() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.apply_oci_queue_transition_snapshot() TO service_role;

REVOKE ALL ON FUNCTION public.append_rpc_claim_transition_batch(uuid[], timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.append_rpc_claim_transition_batch(uuid[], timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.append_rpc_claim_transition_batch(uuid[], timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.append_rpc_claim_transition_batch(uuid[], timestamptz) TO service_role;

REVOKE ALL ON FUNCTION public.append_script_claim_transition_batch(uuid[], timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.append_script_claim_transition_batch(uuid[], timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.append_script_claim_transition_batch(uuid[], timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.append_script_claim_transition_batch(uuid[], timestamptz) TO service_role;

REVOKE ALL ON FUNCTION public.append_script_transition_batch(uuid[], text, timestamptz, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.append_script_transition_batch(uuid[], text, timestamptz, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.append_script_transition_batch(uuid[], text, timestamptz, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.append_script_transition_batch(uuid[], text, timestamptz, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.claim_offline_conversion_rows_for_script_export(uuid[], uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_offline_conversion_rows_for_script_export(uuid[], uuid) FROM anon;
REVOKE ALL ON FUNCTION public.claim_offline_conversion_rows_for_script_export(uuid[], uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_offline_conversion_rows_for_script_export(uuid[], uuid) TO service_role;

REVOKE ALL ON FUNCTION public.append_worker_transition_batch_v2(uuid[], text, timestamptz, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.append_worker_transition_batch_v2(uuid[], text, timestamptz, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.append_worker_transition_batch_v2(uuid[], text, timestamptz, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.append_worker_transition_batch_v2(uuid[], text, timestamptz, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.append_manual_transition_batch(uuid[], text, timestamptz, boolean, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.append_manual_transition_batch(uuid[], text, timestamptz, boolean, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.append_manual_transition_batch(uuid[], text, timestamptz, boolean, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.append_manual_transition_batch(uuid[], text, timestamptz, boolean, text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.update_queue_status_locked(uuid[], uuid, text, boolean, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_queue_status_locked(uuid[], uuid, text, boolean, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.update_queue_status_locked(uuid[], uuid, text, boolean, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.update_queue_status_locked(uuid[], uuid, text, boolean, text, text, text) TO service_role;

COMMIT;

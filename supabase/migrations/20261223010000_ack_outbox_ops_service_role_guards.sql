BEGIN;

-- Panoptic Phase 1: fail-closed SECURITY DEFINER surface — only backend (service_role) may invoke.
-- App paths: lib/oci/ack-receipt.ts, lib/oci/outbox/process-outbox.ts, lib/cron/with-cron-lock.ts, lib/time/db-now.ts

CREATE OR REPLACE FUNCTION public.register_ack_receipt_v1(
  p_site_id uuid,
  p_kind text,
  p_payload_hash text,
  p_request_fingerprint text,
  p_request_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE(
  receipt_id uuid,
  replayed boolean,
  in_progress boolean,
  result_snapshot jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_id uuid;
  existing_id uuid;
  existing_state text;
  existing_snapshot jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'register_ack_receipt_v1 may only be called by service_role' USING ERRCODE = 'P0001';
  END IF;

  IF p_kind NOT IN ('ACK', 'ACK_FAILED') THEN
    RAISE EXCEPTION 'invalid ack receipt kind: %', p_kind USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.ack_receipt_ledger (
    site_id,
    kind,
    payload_hash,
    request_fingerprint,
    request_payload,
    apply_state
  )
  VALUES (
    p_site_id,
    p_kind,
    p_payload_hash,
    p_request_fingerprint,
    COALESCE(p_request_payload, '{}'::jsonb),
    'REGISTERED'
  )
  ON CONFLICT (site_id, kind, payload_hash) DO NOTHING
  RETURNING id INTO inserted_id;

  IF inserted_id IS NOT NULL THEN
    RETURN QUERY
      SELECT inserted_id, FALSE, FALSE, NULL::jsonb;
    RETURN;
  END IF;

  UPDATE public.ack_receipt_ledger
  SET
    replay_count = replay_count + 1,
    replayed_last_at = now(),
    updated_at = now()
  WHERE site_id = p_site_id
    AND kind = p_kind
    AND payload_hash = p_payload_hash
  RETURNING id, apply_state, result_snapshot
  INTO existing_id, existing_state, existing_snapshot;

  RETURN QUERY
    SELECT
      existing_id,
      TRUE,
      existing_state = 'REGISTERED',
      CASE WHEN existing_state = 'APPLIED' THEN existing_snapshot ELSE NULL::jsonb END;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_ack_receipt_v1(
  p_receipt_id uuid,
  p_result_snapshot jsonb
)
RETURNS TABLE(
  receipt_id uuid,
  result_snapshot jsonb,
  applied_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row_id uuid;
  row_snapshot jsonb;
  row_applied_at timestamptz;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'complete_ack_receipt_v1 may only be called by service_role' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.ack_receipt_ledger
  SET
    result_snapshot = COALESCE(result_snapshot, p_result_snapshot),
    applied_at = COALESCE(applied_at, now()),
    apply_state = 'APPLIED',
    updated_at = now()
  WHERE id = p_receipt_id
  RETURNING id, result_snapshot, applied_at
  INTO row_id, row_snapshot, row_applied_at;

  RETURN QUERY
    SELECT row_id, row_snapshot, row_applied_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_outbox_event_v1(
  p_outbox_id uuid,
  p_status text,
  p_last_error text DEFAULT NULL,
  p_attempt_count integer DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  status text,
  processed_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'finalize_outbox_event_v1 may only be called by service_role' USING ERRCODE = 'P0001';
  END IF;

  IF p_status NOT IN ('PROCESSED', 'FAILED', 'PENDING') THEN
    RAISE EXCEPTION 'invalid outbox final status: %', p_status USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
    UPDATE public.outbox_events
    SET
      status = p_status,
      last_error = CASE WHEN p_last_error IS NULL THEN last_error ELSE LEFT(p_last_error, 1000) END,
      attempt_count = COALESCE(p_attempt_count, attempt_count),
      processed_at = CASE WHEN p_status IN ('PROCESSED', 'FAILED') THEN now() ELSE processed_at END,
      updated_at = now()
    WHERE outbox_events.id = p_outbox_id
    RETURNING outbox_events.id, outbox_events.status, outbox_events.processed_at, outbox_events.updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.ops_db_now_v1()
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'ops_db_now_v1 may only be called by service_role' USING ERRCODE = 'P0001';
  END IF;
  RETURN now();
END;
$$;

CREATE OR REPLACE FUNCTION public.try_acquire_cron_lock_v1(
  p_lock_key text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  lock_hash bigint;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'try_acquire_cron_lock_v1 may only be called by service_role' USING ERRCODE = 'P0001';
  END IF;

  lock_hash := hashtext(COALESCE(p_lock_key, ''));
  RETURN pg_try_advisory_xact_lock(lock_hash);
END;
$$;

CREATE OR REPLACE FUNCTION public.sweep_stale_ack_receipts_v1(
  p_stale_seconds integer DEFAULT 300,
  p_limit integer DEFAULT 500
)
RETURNS TABLE(
  receipt_id uuid,
  site_id uuid,
  kind text,
  payload_hash text,
  escalated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'sweep_stale_ack_receipts_v1 may only be called by service_role' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
    WITH stale AS (
      SELECT l.id
      FROM public.ack_receipt_ledger l
      WHERE l.apply_state = 'REGISTERED'
        AND l.created_at <= now() - make_interval(secs => GREATEST(1, p_stale_seconds))
        AND l.result_snapshot IS NULL
      ORDER BY l.created_at ASC
      LIMIT GREATEST(1, p_limit)
      FOR UPDATE SKIP LOCKED
    )
    UPDATE public.ack_receipt_ledger t
    SET
      result_snapshot = COALESCE(
        t.result_snapshot,
        jsonb_build_object(
          'ok', false,
          'code', 'ACK_RECEIPT_STALE_ESCALATED',
          'retryable', true,
          'escalated_by', 'sweep_stale_ack_receipts_v1',
          'escalated_at', now()
        )
      ),
      applied_at = COALESCE(t.applied_at, now()),
      apply_state = 'APPLIED',
      replay_count = t.replay_count + 1,
      replayed_last_at = now(),
      updated_at = now()
    FROM stale
    WHERE t.id = stale.id
    RETURNING t.id, t.site_id, t.kind, t.payload_hash, t.updated_at;
END;
$$;

-- Explicit grants: PostgREST must not expose these to anon/authenticated.
REVOKE ALL ON FUNCTION public.register_ack_receipt_v1(uuid, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_ack_receipt_v1(uuid, text, text, text, jsonb) FROM anon, authenticated;

REVOKE ALL ON FUNCTION public.complete_ack_receipt_v1(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_ack_receipt_v1(uuid, jsonb) FROM anon, authenticated;

REVOKE ALL ON FUNCTION public.finalize_outbox_event_v1(uuid, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_outbox_event_v1(uuid, text, text, integer) FROM anon, authenticated;

REVOKE ALL ON FUNCTION public.ops_db_now_v1() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ops_db_now_v1() FROM anon, authenticated;

REVOKE ALL ON FUNCTION public.try_acquire_cron_lock_v1(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.try_acquire_cron_lock_v1(text) FROM anon, authenticated;

REVOKE ALL ON FUNCTION public.sweep_stale_ack_receipts_v1(integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sweep_stale_ack_receipts_v1(integer, integer) FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.register_ack_receipt_v1(uuid, text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_ack_receipt_v1(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_outbox_event_v1(uuid, text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.ops_db_now_v1() TO service_role;
GRANT EXECUTE ON FUNCTION public.try_acquire_cron_lock_v1(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.sweep_stale_ack_receipts_v1(integer, integer) TO service_role;

COMMIT;

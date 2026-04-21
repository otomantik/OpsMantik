BEGIN;

CREATE TABLE IF NOT EXISTS public.ack_receipt_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('ACK', 'ACK_FAILED')),
  payload_hash text NOT NULL,
  request_fingerprint text NOT NULL,
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_snapshot jsonb,
  replay_count integer NOT NULL DEFAULT 0,
  replayed_last_at timestamptz,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ack_receipt_ledger_unique_request UNIQUE (site_id, kind, payload_hash)
);

CREATE INDEX IF NOT EXISTS ack_receipt_ledger_site_kind_created_idx
  ON public.ack_receipt_ledger (site_id, kind, created_at DESC);

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
  result_snapshot jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_id uuid;
  existing_id uuid;
  existing_snapshot jsonb;
BEGIN
  IF p_kind NOT IN ('ACK', 'ACK_FAILED') THEN
    RAISE EXCEPTION 'invalid ack receipt kind: %', p_kind USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.ack_receipt_ledger (
    site_id,
    kind,
    payload_hash,
    request_fingerprint,
    request_payload
  )
  VALUES (
    p_site_id,
    p_kind,
    p_payload_hash,
    p_request_fingerprint,
    COALESCE(p_request_payload, '{}'::jsonb)
  )
  ON CONFLICT (site_id, kind, payload_hash) DO NOTHING
  RETURNING id INTO inserted_id;

  IF inserted_id IS NOT NULL THEN
    RETURN QUERY
      SELECT inserted_id, FALSE, NULL::jsonb;
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
  RETURNING id, result_snapshot
  INTO existing_id, existing_snapshot;

  RETURN QUERY
    SELECT existing_id, TRUE, existing_snapshot;
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
  UPDATE public.ack_receipt_ledger
  SET
    result_snapshot = COALESCE(result_snapshot, p_result_snapshot),
    applied_at = COALESCE(applied_at, now()),
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
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT now();
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
  lock_hash := hashtext(COALESCE(p_lock_key, ''));
  RETURN pg_try_advisory_xact_lock(lock_hash);
END;
$$;

REVOKE ALL ON TABLE public.ack_receipt_ledger FROM PUBLIC;
GRANT ALL ON TABLE public.ack_receipt_ledger TO service_role;

COMMIT;

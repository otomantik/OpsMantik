BEGIN;

ALTER TABLE public.ack_receipt_ledger
  ADD COLUMN IF NOT EXISTS apply_state text NOT NULL DEFAULT 'REGISTERED'
    CHECK (apply_state IN ('REGISTERED', 'APPLIED'));

UPDATE public.ack_receipt_ledger
SET apply_state = CASE
  WHEN result_snapshot IS NOT NULL OR applied_at IS NOT NULL THEN 'APPLIED'
  ELSE 'REGISTERED'
END
WHERE apply_state IS DISTINCT FROM CASE
  WHEN result_snapshot IS NOT NULL OR applied_at IS NOT NULL THEN 'APPLIED'
  ELSE 'REGISTERED'
END;

-- OUT parameter row type changed across versions, so CREATE OR REPLACE is not enough.
-- Recreate explicitly to avoid SQLSTATE 42P13 on existing environments.
DROP FUNCTION IF EXISTS public.register_ack_receipt_v1(uuid, text, text, text, jsonb);
CREATE FUNCTION public.register_ack_receipt_v1(
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

COMMIT;

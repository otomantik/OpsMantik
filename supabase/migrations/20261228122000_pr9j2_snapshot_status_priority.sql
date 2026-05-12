-- PR-9J.2: semantic latest-transition priority for snapshot selection.
--
-- The previous latest-ledger tie-break used UUID ordering for transitions with
-- identical created_at values. This makes PROCESSING able to beat a terminal
-- transition in same-millisecond claim/finalize paths. Add an explicit
-- semantic priority and patch every latest-transition ORDER BY in the snapshot
-- and assertion functions.

BEGIN;

CREATE OR REPLACE FUNCTION public.oci_status_snapshot_priority(p_status text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_status
    WHEN 'DEAD_LETTER_QUARANTINE' THEN 0
    WHEN 'VOIDED_BY_REVERSAL' THEN 1
    WHEN 'COMPLETED' THEN 2
    WHEN 'COMPLETED_UNVERIFIED' THEN 3
    WHEN 'UPLOADED' THEN 4
    WHEN 'FAILED' THEN 5
    WHEN 'RETRY' THEN 6
    WHEN 'QUEUED' THEN 7
    WHEN 'PROCESSING' THEN 8
    WHEN 'BLOCKED_PRECEDING_SIGNALS' THEN 9
    ELSE 10
  END
$$;

COMMENT ON FUNCTION public.oci_status_snapshot_priority(text)
  IS 'PR-9J.2 deterministic same-timestamp OCI ledger tie-break priority. Lower values win after created_at DESC.';

DO $$
DECLARE
  v_fn text;
BEGIN
  SELECT pg_get_functiondef('public.apply_snapshot_batch(uuid[])'::regprocedure)
  INTO v_fn;

  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'apply_snapshot_batch(uuid[]) not found';
  END IF;

  IF position('public.oci_status_snapshot_priority(t.new_status)' IN v_fn) = 0 THEN
    v_fn := replace(
      v_fn,
      'ORDER BY t.queue_id, t.created_at DESC, t.id DESC',
      'ORDER BY t.queue_id, t.created_at DESC, public.oci_status_snapshot_priority(t.new_status), t.id DESC'
    );
    EXECUTE v_fn;
  END IF;

  SELECT pg_get_functiondef('public.assert_latest_ledger_matches_snapshot(uuid[])'::regprocedure)
  INTO v_fn;

  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'assert_latest_ledger_matches_snapshot(uuid[]) not found';
  END IF;

  IF position('public.oci_status_snapshot_priority(t.new_status)' IN v_fn) = 0 THEN
    v_fn := replace(
      v_fn,
      'ORDER BY t.queue_id, t.created_at DESC, t.id DESC',
      'ORDER BY t.queue_id, t.created_at DESC, public.oci_status_snapshot_priority(t.new_status), t.id DESC'
    );
    EXECUTE v_fn;
  END IF;
END;
$$;

ALTER FUNCTION public.apply_snapshot_batch(uuid[]) OWNER TO postgres;
ALTER FUNCTION public.assert_latest_ledger_matches_snapshot(uuid[]) OWNER TO postgres;
ALTER FUNCTION public.oci_status_snapshot_priority(text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.oci_status_snapshot_priority(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.oci_status_snapshot_priority(text) FROM anon;
REVOKE ALL ON FUNCTION public.oci_status_snapshot_priority(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.oci_status_snapshot_priority(text) TO service_role;

COMMIT;

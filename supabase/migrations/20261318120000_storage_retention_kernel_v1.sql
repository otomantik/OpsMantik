BEGIN;

-- STORAGE_RETENTION_KERNEL_AUDIT_FIRST — batch RPCs, indexes, lock/statement timeouts.

--------------------------------------------------------------------------------
-- PR-B1: Outbox cleanup index (processed_at) + batch RPC
--------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_outbox_events_cleanup_processed
  ON public.outbox_events (processed_at)
  WHERE status = 'PROCESSED';

COMMENT ON INDEX idx_outbox_events_cleanup_processed IS
  'Retention: DELETE PROCESSED rows by processed_at (replaces created_at-only cleanup scan).';

CREATE OR REPLACE FUNCTION public.delete_outbox_processed_batch(
  p_days_old integer DEFAULT 7,
  p_limit integer DEFAULT 5000,
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff timestamptz;
  v_limit int;
  v_count int;
  v_deleted int := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'delete_outbox_processed_batch: service_role only' USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('lock_timeout', '2s', true);
  PERFORM set_config('statement_timeout', '45s', true);

  v_cutoff := now() - (LEAST(GREATEST(COALESCE(p_days_old, 7), 1), 365) || ' days')::interval;
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 5000), 1), 10000);

  SELECT count(*)::int INTO v_count
  FROM public.outbox_events
  WHERE status = 'PROCESSED' AND processed_at IS NOT NULL AND processed_at < v_cutoff;

  IF NOT p_dry_run THEN
    WITH to_delete AS (
      SELECT id
      FROM public.outbox_events
      WHERE status = 'PROCESSED' AND processed_at IS NOT NULL AND processed_at < v_cutoff
      ORDER BY processed_at ASC
      LIMIT v_limit
    )
    DELETE FROM public.outbox_events o
    USING to_delete d
    WHERE o.id = d.id;

    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    ANALYZE public.outbox_events;
  ELSE
    v_deleted := LEAST(v_count, v_limit);
  END IF;

  RETURN jsonb_build_object(
    'affected', v_deleted,
    'eligible', v_count,
    'dry_run', p_dry_run,
    'limit', v_limit,
    'cutoff', v_cutoff
  );
END;
$$;

--------------------------------------------------------------------------------
-- PR-B2: GDPR batch anonymize + partial index
--------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_sessions_consentless_created
  ON public.sessions (created_at)
  WHERE consent_at IS NULL
    AND (consent_scopes IS NULL OR consent_scopes = '{}');

CREATE OR REPLACE FUNCTION public.anonymize_consent_less_data_batch(
  p_days integer DEFAULT 90,
  p_limit integer DEFAULT 5000,
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff timestamptz;
  v_limit int;
  v_sessions bigint := 0;
  v_events bigint := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'anonymize_consent_less_data_batch: service_role only' USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('lock_timeout', '2s', true);
  PERFORM set_config('statement_timeout', '45s', true);

  v_cutoff := now() - (LEAST(GREATEST(COALESCE(NULLIF(p_days, 0), 90), 1), 365) || ' days')::interval;
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 5000), 1), 10000);

  IF p_dry_run THEN
    SELECT count(*)::bigint INTO v_sessions
    FROM public.sessions
    WHERE consent_at IS NULL
      AND (consent_scopes IS NULL OR consent_scopes = '{}')
      AND created_at < v_cutoff;

    SELECT count(*)::bigint INTO v_events
    FROM public.events
    WHERE consent_at IS NULL
      AND (consent_scopes IS NULL OR consent_scopes = '{}')
      AND created_at < v_cutoff;

    v_sessions := LEAST(v_sessions, v_limit);
    v_events := LEAST(v_events, v_limit);
  ELSE
    WITH batch AS (
      SELECT id, created_month
      FROM public.sessions
      WHERE consent_at IS NULL
        AND (consent_scopes IS NULL OR consent_scopes = '{}')
        AND created_at < v_cutoff
      ORDER BY created_at ASC
      LIMIT v_limit
    ),
    upds AS (
      UPDATE public.sessions s SET
        ip_address = NULL, entry_page = NULL, exit_page = NULL,
        gclid = NULL, wbraid = NULL, gbraid = NULL, fingerprint = NULL,
        ai_summary = NULL, ai_tags = NULL, user_journey_path = NULL
      FROM batch b
      WHERE s.id = b.id AND s.created_month = b.created_month
      RETURNING 1
    )
    SELECT count(*)::bigint INTO v_sessions FROM upds;

    WITH batch AS (
      SELECT id, session_month
      FROM public.events
      WHERE consent_at IS NULL
        AND (consent_scopes IS NULL OR consent_scopes = '{}')
        AND created_at < v_cutoff
      ORDER BY created_at ASC
      LIMIT v_limit
    ),
    upds AS (
      UPDATE public.events e SET metadata = '{}'
      FROM batch b
      WHERE e.id = b.id AND e.session_month = b.session_month
      RETURNING 1
    )
    SELECT count(*)::bigint INTO v_events FROM upds;

    IF v_sessions > 0 OR v_events > 0 THEN
      ANALYZE public.sessions;
      ANALYZE public.events;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'sessions_affected', v_sessions,
    'events_affected', v_events,
    'dry_run', p_dry_run,
    'limit', v_limit,
    'cutoff', v_cutoff
  );
END;
$$;

--------------------------------------------------------------------------------
-- PR-C1: processed_signals stale fail + retention
--------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_processed_signals_created_at
  ON public.processed_signals (created_at);

CREATE OR REPLACE FUNCTION public.fail_stale_processed_signals_batch(
  p_age_minutes integer DEFAULT 31,
  p_limit integer DEFAULT 5000,
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff timestamptz;
  v_limit int;
  v_affected int := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'fail_stale_processed_signals_batch: service_role only' USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('lock_timeout', '2s', true);
  PERFORM set_config('statement_timeout', '45s', true);

  v_cutoff := now() - (LEAST(GREATEST(COALESCE(p_age_minutes, 31), 5), 1440) || ' minutes')::interval;
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 5000), 1), 10000);

  IF p_dry_run THEN
    SELECT count(*)::int INTO v_affected
    FROM public.processed_signals
    WHERE status = 'processing' AND created_at < v_cutoff;
    v_affected := LEAST(v_affected, v_limit);
  ELSE
    WITH batch AS (
      SELECT event_id
      FROM public.processed_signals
      WHERE status = 'processing' AND created_at < v_cutoff
      ORDER BY created_at ASC
      LIMIT v_limit
    )
    UPDATE public.processed_signals ps
    SET status = 'failed'
    FROM batch b
    WHERE ps.event_id = b.event_id;

    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected > 0 THEN
      ANALYZE public.processed_signals;
    END IF;
  END IF;

  RETURN jsonb_build_object('affected', v_affected, 'dry_run', p_dry_run, 'limit', v_limit);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_processed_signals_batch(
  p_days_old integer DEFAULT 90,
  p_limit integer DEFAULT 5000,
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff timestamptz;
  v_limit int;
  v_affected int := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'delete_processed_signals_batch: service_role only' USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('lock_timeout', '2s', true);
  PERFORM set_config('statement_timeout', '45s', true);

  v_cutoff := now() - (LEAST(GREATEST(COALESCE(p_days_old, 90), 30), 365) || ' days')::interval;
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 5000), 1), 10000);

  IF p_dry_run THEN
    SELECT count(*)::int INTO v_affected
    FROM public.processed_signals
    WHERE status IN ('processed', 'failed', 'skipped')
      AND created_at < v_cutoff;
    v_affected := LEAST(v_affected, v_limit);
  ELSE
    WITH batch AS (
      SELECT event_id
      FROM public.processed_signals
      WHERE status IN ('processed', 'failed', 'skipped')
        AND created_at < v_cutoff
      ORDER BY created_at ASC
      LIMIT v_limit
    )
    DELETE FROM public.processed_signals ps
    USING batch b
    WHERE ps.event_id = b.event_id;

    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected > 0 THEN
      ANALYZE public.processed_signals;
    END IF;
  END IF;

  RETURN jsonb_build_object('affected', v_affected, 'dry_run', p_dry_run, 'limit', v_limit, 'cutoff', v_cutoff);
END;
$$;

--------------------------------------------------------------------------------
-- PR-C2: OCI queue cleanup — smaller default batch + dry_run + index
--------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.cleanup_oci_queue_batch(integer, integer);

CREATE INDEX IF NOT EXISTS idx_offline_conversion_queue_terminal_updated
  ON public.offline_conversion_queue (updated_at)
  WHERE status IN ('COMPLETED', 'FATAL', 'FAILED');

CREATE OR REPLACE FUNCTION public.cleanup_oci_queue_batch(
  p_days_to_keep integer DEFAULT 90,
  p_limit integer DEFAULT 500,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff timestamptz;
  v_limit int;
  v_deleted int := 0;
  v_eligible int;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'cleanup_oci_queue_batch may only be called by service_role' USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('lock_timeout', '2s', true);
  PERFORM set_config('statement_timeout', '45s', true);

  v_cutoff := now() - (LEAST(GREATEST(p_days_to_keep, 1), 365) || ' days')::interval;
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 500), 1), 10000);

  SELECT count(*)::int INTO v_eligible
  FROM public.offline_conversion_queue
  WHERE status IN ('COMPLETED', 'FATAL', 'FAILED')
    AND updated_at < v_cutoff;

  IF NOT p_dry_run THEN
    WITH to_delete AS (
      SELECT id
      FROM public.offline_conversion_queue
      WHERE status IN ('COMPLETED', 'FATAL', 'FAILED')
        AND updated_at < v_cutoff
      ORDER BY updated_at ASC
      LIMIT v_limit
    )
    DELETE FROM public.offline_conversion_queue
    WHERE id IN (SELECT id FROM to_delete);

    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    IF v_deleted > 0 THEN
      ANALYZE public.offline_conversion_queue;
    END IF;
  ELSE
    v_deleted := LEAST(v_eligible, v_limit);
  END IF;

  RETURN jsonb_build_object(
    'affected', v_deleted,
    'eligible', v_eligible,
    'dry_run', p_dry_run,
    'limit', v_limit
  );
END;
$$;

--------------------------------------------------------------------------------
-- PR-C3: marketing_signals + truth_evidence retention
--------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.cleanup_marketing_signals_batch(integer, integer);

CREATE OR REPLACE FUNCTION public.cleanup_marketing_signals_batch(
  p_days_old integer DEFAULT 60,
  p_limit integer DEFAULT 5000,
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff timestamptz;
  v_limit int;
  v_deleted int := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'cleanup_marketing_signals_batch may only be called by service_role' USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('lock_timeout', '2s', true);
  PERFORM set_config('statement_timeout', '45s', true);

  v_cutoff := now() - (LEAST(GREATEST(p_days_old, 1), 365) || ' days')::interval;
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 5000), 1), 10000);

  IF p_dry_run THEN
    SELECT count(*)::int INTO v_deleted
    FROM public.marketing_signals
    WHERE dispatch_status = 'SENT' AND created_at < v_cutoff;
    v_deleted := LEAST(v_deleted, v_limit);
  ELSE
    WITH to_delete AS (
      SELECT id
      FROM public.marketing_signals
      WHERE dispatch_status = 'SENT' AND created_at < v_cutoff
      ORDER BY created_at ASC
      LIMIT v_limit
    )
    DELETE FROM public.marketing_signals
    WHERE id IN (SELECT id FROM to_delete);

    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    IF v_deleted > 0 THEN
      ANALYZE public.marketing_signals;
    END IF;
  END IF;

  RETURN jsonb_build_object('affected', v_deleted, 'dry_run', p_dry_run, 'limit', v_limit);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_truth_evidence_batch(
  p_days_old integer DEFAULT 90,
  p_limit integer DEFAULT 5000,
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff timestamptz;
  v_limit int;
  v_deleted int := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'delete_truth_evidence_batch: service_role only' USING ERRCODE = 'P0001';
  END IF;

  IF to_regclass('public.truth_evidence_ledger') IS NULL THEN
    RETURN jsonb_build_object('affected', 0, 'dry_run', p_dry_run, 'skipped', true, 'reason', 'table_missing');
  END IF;

  PERFORM set_config('lock_timeout', '2s', true);
  PERFORM set_config('statement_timeout', '45s', true);

  v_cutoff := now() - (LEAST(GREATEST(p_days_old, 90), 730) || ' days')::interval;
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 5000), 1), 10000);

  IF p_dry_run THEN
    EXECUTE format(
      'SELECT count(*)::int FROM public.truth_evidence_ledger WHERE occurred_at < %L',
      v_cutoff
    ) INTO v_deleted;
    v_deleted := LEAST(v_deleted, v_limit);
  ELSE
    EXECUTE format(
      $q$
      WITH batch AS (
        SELECT id FROM public.truth_evidence_ledger
        WHERE occurred_at < %L
        ORDER BY occurred_at ASC
        LIMIT %s
      )
      DELETE FROM public.truth_evidence_ledger t
      USING batch b WHERE t.id = b.id
      $q$,
      v_cutoff,
      v_limit
    );
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    EXECUTE 'ANALYZE public.truth_evidence_ledger';
  END IF;

  RETURN jsonb_build_object('affected', v_deleted, 'dry_run', p_dry_run, 'limit', v_limit);
END;
$$;

--------------------------------------------------------------------------------
-- Grants (service_role only)
--------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.delete_outbox_processed_batch(integer, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_outbox_processed_batch(integer, integer, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.anonymize_consent_less_data_batch(integer, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.anonymize_consent_less_data_batch(integer, integer, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.fail_stale_processed_signals_batch(integer, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_stale_processed_signals_batch(integer, integer, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.delete_processed_signals_batch(integer, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_processed_signals_batch(integer, integer, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.delete_truth_evidence_batch(integer, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_truth_evidence_batch(integer, integer, boolean) TO service_role;

-- cleanup_oci_queue_batch / cleanup_marketing_signals_batch (3-arg jsonb overload)
REVOKE ALL ON FUNCTION public.cleanup_oci_queue_batch(integer, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_oci_queue_batch(integer, integer, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.cleanup_marketing_signals_batch(integer, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_marketing_signals_batch(integer, integer, boolean) TO service_role;

COMMIT;

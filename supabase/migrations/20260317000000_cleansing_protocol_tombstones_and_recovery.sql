-- =============================================================================
-- The Cleansing Protocol: Tombstones, Zombie Recovery, Marketing Signals Retention
-- Hardening: source_queue_id UNIQUE, FOR UPDATE SKIP LOCKED, revive dry_run
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) offline_conversion_tombstones (archive FAILED rows)
-- source_queue_id UNIQUE prevents double-archive on concurrent runs
-- queue_snapshot: full row data for revival (conversion_time, value_cents, etc.)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.offline_conversion_tombstones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_queue_id uuid NOT NULL UNIQUE,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  provider_key text NOT NULL,
  payload jsonb NOT NULL,
  queue_snapshot jsonb NOT NULL DEFAULT '{}',
  failure_summary jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_offline_conversion_tombstones_site_created
  ON public.offline_conversion_tombstones (site_id, created_at);

COMMENT ON TABLE public.offline_conversion_tombstones IS
  'Archived FAILED conversions. queue_snapshot = full row for revival. source_queue_id UNIQUE prevents double-archive.';

-- -----------------------------------------------------------------------------
-- 2) archive_failed_conversions_batch — FOR UPDATE SKIP LOCKED for concurrency
-- INSERT tombstones + DELETE queue; ANALYZE at end for stats
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.archive_failed_conversions_batch(
  p_days_old int DEFAULT 30,
  p_limit int DEFAULT 5000
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff timestamptz;
  v_archived int;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'archive_failed_conversions_batch may only be called by service_role' USING ERRCODE = 'P0001';
  END IF;

  v_cutoff := now() - (LEAST(GREATEST(p_days_old, 1), 365) || ' days')::interval;

  WITH to_archive AS (
    SELECT q.id, q.site_id, q.provider_key, q.payload,
           jsonb_build_object(
             'conversion_time', q.conversion_time,
             'value_cents', q.value_cents,
             'currency', q.currency,
             'gclid', q.gclid,
             'wbraid', q.wbraid,
             'gbraid', q.gbraid,
             'call_id', q.call_id,
             'sale_id', q.sale_id,
             'order_id', q.payload->>'order_id'
           ) AS queue_snapshot,
           jsonb_build_object(
             'retry_count', q.retry_count,
             'attempt_count', q.attempt_count,
             'last_error', q.last_error,
             'provider_error_code', q.provider_error_code,
             'provider_error_category', q.provider_error_category,
             'created_at', q.created_at,
             'updated_at', q.updated_at,
             'failed_at', q.updated_at
           ) AS failure_summary
    FROM public.offline_conversion_queue q
    WHERE q.status = 'FAILED'
      AND q.updated_at < v_cutoff
    ORDER BY q.updated_at ASC
    LIMIT LEAST(GREATEST(p_limit, 1), 10000)
    FOR UPDATE SKIP LOCKED
  ),
  inserted AS (
    INSERT INTO public.offline_conversion_tombstones (source_queue_id, site_id, provider_key, payload, queue_snapshot, failure_summary)
    SELECT id, site_id, provider_key, payload, queue_snapshot, failure_summary FROM to_archive
    ON CONFLICT (source_queue_id) DO NOTHING
    RETURNING source_queue_id
  ),
  deleted AS (
    DELETE FROM public.offline_conversion_queue
    WHERE id IN (SELECT source_queue_id FROM inserted)
    RETURNING id
  )
  SELECT count(*)::int INTO v_archived FROM deleted;

  IF v_archived > 0 THEN
    EXECUTE 'ANALYZE public.offline_conversion_queue';
  END IF;

  RETURN v_archived;
END;
$$;

COMMENT ON FUNCTION public.archive_failed_conversions_batch(int, int) IS
  'Archive FAILED conversions older than p_days_old to tombstones. FOR UPDATE SKIP LOCKED. ANALYZE on success. service_role only.';

GRANT EXECUTE ON FUNCTION public.archive_failed_conversions_batch(int, int) TO service_role;

-- -----------------------------------------------------------------------------
-- 3) revive_dead_cohort — p_dry_run DEFAULT true for safety
-- Filter: site_id, date_range, error_type (optional)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revive_dead_cohort(
  p_filter jsonb DEFAULT '{}',
  p_limit int DEFAULT 1000,
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := 0;
  v_revived int := 0;
  v_row record;
  v_from_ts timestamptz;
  v_to_ts timestamptz;
  v_site_id uuid;
  v_error_type text;
  v_order_id text;
  v_payload jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'FORBIDDEN');
  END IF;

  v_site_id := (p_filter->>'site_id')::uuid;
  v_error_type := p_filter->>'error_type';
  IF p_filter ? 'date_range' THEN
    v_from_ts := (p_filter->'date_range'->>'from')::timestamptz;
    v_to_ts := (p_filter->'date_range'->>'to')::timestamptz;
  END IF;

  FOR v_row IN
    SELECT t.id, t.site_id, t.provider_key, t.payload, t.queue_snapshot, t.failure_summary
    FROM public.offline_conversion_tombstones t
    WHERE (v_site_id IS NULL OR t.site_id = v_site_id)
      AND (v_from_ts IS NULL OR t.created_at >= v_from_ts)
      AND (v_to_ts IS NULL OR t.created_at <= v_to_ts)
      AND (v_error_type IS NULL OR t.failure_summary->>'last_error' ILIKE '%' || v_error_type || '%')
    ORDER BY t.created_at ASC
    LIMIT LEAST(GREATEST(p_limit, 1), 5000)
  LOOP
    v_count := v_count + 1;
    v_order_id := COALESCE(v_row.payload->>'order_id', v_row.queue_snapshot->>'order_id', '') || '_revived';
    v_payload := jsonb_set(COALESCE(v_row.payload, '{}'::jsonb), '{order_id}', to_jsonb(v_order_id));

    IF NOT p_dry_run THEN
      INSERT INTO public.offline_conversion_queue (
        site_id, sale_id, call_id, provider_key, payload, status, retry_count, attempt_count,
        conversion_time, value_cents, currency, gclid, wbraid, gbraid, created_at, updated_at
      )
      SELECT
        v_row.site_id,
        (v_row.queue_snapshot->>'sale_id')::uuid,
        (v_row.queue_snapshot->>'call_id')::uuid,
        v_row.provider_key,
        v_payload,
        'QUEUED',
        0,
        0,
        COALESCE((v_row.queue_snapshot->>'conversion_time')::timestamptz, now()),
        COALESCE((v_row.queue_snapshot->>'value_cents')::bigint, 0),
        COALESCE(v_row.queue_snapshot->>'currency', 'TRY'),
        v_row.queue_snapshot->>'gclid',
        v_row.queue_snapshot->>'wbraid',
        v_row.queue_snapshot->>'gbraid',
        now(),
        now()
      WHERE (
          (v_row.queue_snapshot->>'sale_id')::uuid IS NOT NULL
          OR (v_row.queue_snapshot->>'call_id')::uuid IS NOT NULL
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.offline_conversion_queue q
          WHERE q.site_id = v_row.site_id AND q.payload->>'order_id' = v_order_id
        );

      IF FOUND THEN
        DELETE FROM public.offline_conversion_tombstones WHERE id = v_row.id;
        v_revived := v_revived + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'dry_run', p_dry_run,
    'would_revive', v_count,
    'revived', v_revived
  );
END;
$$;

COMMENT ON FUNCTION public.revive_dead_cohort(jsonb, int, boolean) IS
  'Resurrect tombstone rows to queue. p_dry_run=true by default. service_role only.';

GRANT EXECUTE ON FUNCTION public.revive_dead_cohort(jsonb, int, boolean) TO service_role;

-- -----------------------------------------------------------------------------
-- 4) ingest_fallback_buffer: add updated_at
-- -----------------------------------------------------------------------------
ALTER TABLE public.ingest_fallback_buffer
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

UPDATE public.ingest_fallback_buffer SET updated_at = created_at WHERE updated_at IS NULL;
ALTER TABLE public.ingest_fallback_buffer ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE public.ingest_fallback_buffer ALTER COLUMN updated_at SET NOT NULL;

-- -----------------------------------------------------------------------------
-- 5) get_and_claim_fallback_batch: set updated_at on claim (preserves oci_sync_method filter)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_and_claim_fallback_batch(p_limit INT DEFAULT 100)
RETURNS TABLE (
  id UUID,
  site_id UUID,
  payload JSONB,
  error_reason TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH locked AS (
    SELECT b.id
    FROM public.ingest_fallback_buffer b
    JOIN public.sites s ON s.id = b.site_id
    WHERE b.status = 'PENDING'
      AND s.oci_sync_method = 'api'
    ORDER BY b.created_at
    LIMIT p_limit
    FOR UPDATE OF b SKIP LOCKED
  ),
  updated AS (
    UPDATE public.ingest_fallback_buffer b
    SET status = 'PROCESSING', updated_at = now()
    FROM locked
    WHERE b.id = locked.id
    RETURNING b.id, b.site_id, b.payload, b.error_reason, b.created_at
  )
  SELECT updated.id, updated.site_id, updated.payload, updated.error_reason, updated.created_at
  FROM updated;
END;
$$;

COMMENT ON FUNCTION public.get_and_claim_fallback_batch(INT) IS
  'Recovery worker: claim PENDING rows (oci_sync_method = api). Sets updated_at for zombie recovery.';

-- -----------------------------------------------------------------------------
-- 6) recover_stuck_ingest_fallback — zombies (PROCESSING > p_min_age)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recover_stuck_ingest_fallback(p_min_age_minutes int DEFAULT 120)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated int;
  v_cutoff timestamptz;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'recover_stuck_ingest_fallback may only be called by service_role' USING ERRCODE = 'P0001';
  END IF;

  v_cutoff := now() - (p_min_age_minutes || ' minutes')::interval;

  WITH updated AS (
    UPDATE public.ingest_fallback_buffer
    SET status = 'PENDING', updated_at = now()
    WHERE status = 'PROCESSING'
      AND updated_at < v_cutoff
    RETURNING id
  )
  SELECT count(*)::int INTO v_updated FROM updated;

  RETURN v_updated;
END;
$$;

COMMENT ON FUNCTION public.recover_stuck_ingest_fallback(int) IS
  'Reset ingest_fallback_buffer PROCESSING rows older than p_min_age_minutes to PENDING. service_role only.';

GRANT EXECUTE ON FUNCTION public.recover_stuck_ingest_fallback(int) TO service_role;

-- -----------------------------------------------------------------------------
-- 7) recover_stuck_offline_conversion_jobs: retry_count >= 7 -> FAILED
-- Otherwise -> RETRY. 2h default for zombie recovery.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recover_stuck_offline_conversion_jobs(p_min_age_minutes int DEFAULT 120)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_retry int := 0;
  v_failed int := 0;
  v_cutoff timestamptz := now() - (p_min_age_minutes || ' minutes')::interval;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'recover_stuck_offline_conversion_jobs may only be called by service_role' USING ERRCODE = 'P0001';
  END IF;

  -- Max retries exhausted: PROCESSING -> FAILED (tombstone path)
  WITH u1 AS (
    UPDATE public.offline_conversion_queue q
    SET status = 'FAILED', updated_at = now(),
        last_error = COALESCE(last_error, 'Zombie recovered: max retries exhausted')::text
    WHERE q.status = 'PROCESSING'
      AND (q.retry_count >= 7 OR q.attempt_count >= 7)
      AND (q.claimed_at < v_cutoff OR (q.claimed_at IS NULL AND q.updated_at < v_cutoff))
    RETURNING q.id
  )
  SELECT count(*)::int INTO v_failed FROM u1;

  -- Still retriable: PROCESSING -> RETRY
  WITH u2 AS (
    UPDATE public.offline_conversion_queue q
    SET status = 'RETRY', next_retry_at = NULL, updated_at = now()
    WHERE q.status = 'PROCESSING'
      AND q.retry_count < 7
      AND q.attempt_count < 7
      AND (q.claimed_at < v_cutoff OR (q.claimed_at IS NULL AND q.updated_at < v_cutoff))
    RETURNING q.id
  )
  SELECT count(*)::int INTO v_retry FROM u2;

  RETURN v_retry + v_failed;
END;
$$;

COMMENT ON FUNCTION public.recover_stuck_offline_conversion_jobs(int) IS
  'Zombie recovery: PROCESSING older than p_min_age. retry/attempt >= 7 -> FAILED; else RETRY. service_role only.';

-- -----------------------------------------------------------------------------
-- 8) marketing_signals: alter trigger to allow SENT+60d deletes
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._marketing_signals_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.dispatch_status = 'SENT' AND OLD.created_at < (now() - interval '60 days') THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'marketing_signals: DELETE not allowed (append-only). SENT rows older than 60 days may be purged via cleanup RPC.';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.site_id != OLD.site_id OR NEW.signal_type != OLD.signal_type OR NEW.google_conversion_name != OLD.google_conversion_name THEN
      RAISE EXCEPTION 'marketing_signals: signal content immutable. Only dispatch_status and google_sent_at may be updated.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- 9) cleanup_marketing_signals_batch — SENT older than p_days_old
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleanup_marketing_signals_batch(
  p_days_old int DEFAULT 60,
  p_limit int DEFAULT 5000
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff timestamptz;
  v_deleted int;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'cleanup_marketing_signals_batch may only be called by service_role' USING ERRCODE = 'P0001';
  END IF;

  v_cutoff := now() - (LEAST(GREATEST(p_days_old, 1), 365) || ' days')::interval;

  WITH to_delete AS (
    SELECT id FROM public.marketing_signals
    WHERE dispatch_status = 'SENT'
      AND created_at < v_cutoff
    ORDER BY created_at ASC
    LIMIT LEAST(GREATEST(p_limit, 1), 10000)
  )
  DELETE FROM public.marketing_signals
  WHERE id IN (SELECT id FROM to_delete);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION public.cleanup_marketing_signals_batch(int, int) IS
  'Delete SENT marketing_signals older than p_days_old. service_role only.';

GRANT EXECUTE ON FUNCTION public.cleanup_marketing_signals_batch(int, int) TO service_role;

COMMIT;

-- Queue actions with row-level locking (SELECT FOR UPDATE) to prevent race conditions.
-- RPC: update_queue_status_locked — locks rows before update; service_role only.

BEGIN;

CREATE OR REPLACE FUNCTION public.update_queue_status_locked(
  p_ids uuid[],
  p_site_id uuid,
  p_action text,
  p_clear_errors boolean DEFAULT false,
  p_error_code text DEFAULT 'MANUAL_FAIL',
  p_error_category text DEFAULT 'PERMANENT',
  p_reason text DEFAULT 'MANUALLY_MARKED_FAILED'
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_affected int;
  v_now timestamptz := now();
  v_status_filter text[];
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'update_queue_status_locked may only be called by service_role', ERRCODE = 'P0001';
  END IF;

  IF array_length(p_ids, 1) IS NULL OR array_length(p_ids, 1) = 0 THEN
    RETURN 0;
  END IF;

  CASE p_action
    WHEN 'RETRY_SELECTED' THEN
      v_status_filter := ARRAY['FAILED', 'RETRY'];
      WITH to_update AS (
        SELECT q.id
        FROM public.offline_conversion_queue q
        WHERE q.id = ANY(p_ids)
          AND q.site_id = p_site_id
          AND q.status = ANY(v_status_filter)
        FOR UPDATE
      )
      UPDATE public.offline_conversion_queue q
      SET status = 'QUEUED', claimed_at = NULL, next_retry_at = NULL, updated_at = v_now
      FROM to_update
      WHERE q.id = to_update.id;
      GET DIAGNOSTICS v_affected = ROW_COUNT;

    WHEN 'RESET_TO_QUEUED' THEN
      v_status_filter := ARRAY['QUEUED', 'RETRY', 'PROCESSING', 'FAILED'];
      IF p_clear_errors THEN
        WITH to_update AS (
          SELECT q.id
          FROM public.offline_conversion_queue q
          WHERE q.id = ANY(p_ids)
            AND q.site_id = p_site_id
            AND q.status = ANY(v_status_filter)
          FOR UPDATE
        )
        UPDATE public.offline_conversion_queue q
        SET status = 'QUEUED', claimed_at = NULL, next_retry_at = NULL,
            last_error = NULL, provider_error_code = NULL, provider_error_category = NULL,
            updated_at = v_now
        FROM to_update
        WHERE q.id = to_update.id;
      ELSE
        WITH to_update AS (
          SELECT q.id
          FROM public.offline_conversion_queue q
          WHERE q.id = ANY(p_ids)
            AND q.site_id = p_site_id
            AND q.status = ANY(v_status_filter)
          FOR UPDATE
        )
        UPDATE public.offline_conversion_queue q
        SET status = 'QUEUED', claimed_at = NULL, next_retry_at = NULL, updated_at = v_now
        FROM to_update
        WHERE q.id = to_update.id;
      END IF;
      GET DIAGNOSTICS v_affected = ROW_COUNT;

    WHEN 'MARK_FAILED' THEN
      v_status_filter := ARRAY['PROCESSING', 'QUEUED', 'RETRY'];
      WITH to_update AS (
        SELECT q.id
        FROM public.offline_conversion_queue q
        WHERE q.id = ANY(p_ids)
          AND q.site_id = p_site_id
          AND q.status = ANY(v_status_filter)
        FOR UPDATE
      )
      UPDATE public.offline_conversion_queue q
      SET status = 'FAILED',
          last_error = left(p_reason, 1024),
          provider_error_code = left(p_error_code, 64),
          provider_error_category = p_error_category,
          updated_at = v_now
      FROM to_update
      WHERE q.id = to_update.id;
      GET DIAGNOSTICS v_affected = ROW_COUNT;

    ELSE
      RAISE EXCEPTION USING MESSAGE = 'invalid_action', DETAIL = 'action must be RETRY_SELECTED, RESET_TO_QUEUED, or MARK_FAILED', ERRCODE = 'P0001';
  END CASE;

  RETURN v_affected;
END;
$$;

COMMENT ON FUNCTION public.update_queue_status_locked(uuid[], uuid, text, boolean, text, text, text) IS
  'Queue actions with row-level locking (FOR UPDATE) to prevent concurrent mutations. service_role only.';

GRANT EXECUTE ON FUNCTION public.update_queue_status_locked(uuid[], uuid, text, boolean, text, text, text) TO service_role;

COMMIT;

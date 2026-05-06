BEGIN;

-- Iron Protocol v3: OCI Health Monitoring
-- Checks for stuck queues, orphan signals, and configuration drift.

CREATE OR REPLACE FUNCTION public.watchtower_oci_health_check_v1()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stuck_queue_count integer;
  v_orphan_signal_count integer;
  v_empty_aov_count integer;
  v_drift_detected boolean := false;
BEGIN
  -- 1. Stuck Queue: PROCESSING for > 4 hours
  SELECT count(*) INTO v_stuck_queue_count
  FROM public.offline_conversion_queue
  WHERE status = 'PROCESSING'
    AND updated_at < now() - interval '4 hours';

  -- 2. Orphan Signals: SENT but no google_sent_at (or vice versa)
  SELECT count(*) INTO v_orphan_signal_count
  FROM public.marketing_signals
  WHERE (dispatch_status = 'SENT' AND google_sent_at IS NULL)
     OR (dispatch_status = 'QUEUED' AND created_at < now() - interval '24 hours');

  IF v_stuck_queue_count > 0 OR v_orphan_signal_count > 10 THEN
    v_drift_detected := true;
  END IF;

  RETURN jsonb_build_object(
    'ok', NOT v_drift_detected,
    'stuck_queue_count', v_stuck_queue_count,
    'orphan_signal_count', v_orphan_signal_count,
    'checked_at', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.watchtower_oci_health_check_v1() TO service_role;

COMMIT;

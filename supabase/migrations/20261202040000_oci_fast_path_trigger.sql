-- =============================================================================
-- Phase 4: OCI Fast-Path Trigger
-- Description: Real-time "Blind Ping" signaling for immediate conversion dispatch.
-- 
-- Prerequisites:
-- 1. private.api_keys tablosuna 'qstash_token' ve 'project_url' eklenmiş olmalı.
-- 2. pg_net extension devrede olmalı.
-- =============================================================================

-- 1) Create the trigger function
CREATE OR REPLACE FUNCTION public.notify_oci_runner_fast_path()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, net, extensions
AS $$
DECLARE
  v_qstash_token text;
  v_project_url text;
  v_target_url text;
  v_qstash_publish_url text;
  v_headers jsonb;
  v_body jsonb;
  v_dedup_id text;
  v_bucket text;
BEGIN
  -- 1. Read secrets from private.api_keys
  SELECT key_value INTO v_qstash_token FROM private.api_keys WHERE key_name = 'qstash_token';
  SELECT key_value INTO v_project_url FROM private.api_keys WHERE key_name = 'project_url';
  
  IF v_qstash_token IS NULL OR v_project_url IS NULL THEN
    RAISE NOTICE 'OCI Fast-Path: qstash_token or project_url missing in private.api_keys; skipping real-time signal.';
    RETURN NEW;
  END IF;

  -- 2. Build Target URL (Google Ads OCI Worker)
  v_target_url := rtrim(v_project_url, '/') || '/api/workers/google-ads-oci';
  
  -- 3. QStash Publish URL
  v_qstash_publish_url := 'https://qstash.upstash.io/v2/publish/' || v_target_url;

  -- 4. Coalesce bursts by minute (Architect's ruling: shock absorber)
  v_bucket := to_char(current_timestamp, 'YYYYMMDDHH24MI');
  v_dedup_id := 'oci_fastpath_site_' || NEW.site_id || '_' || v_bucket;

  -- 5. Prepare Headers (Architect's ruling: Upstash-Retries: 0)
  v_headers := jsonb_build_object(
    'Authorization', 'Bearer ' || v_qstash_token,
    'Upstash-Deduplication-Id', v_dedup_id,
    'Upstash-Retries', '0',
    'Content-Type', 'application/json'
  );

  -- 6. Prepare Body (Architect's ruling: Blind Ping)
  v_body := jsonb_build_object(
    'event', 'wakeup',
    'site_id', NEW.site_id,
    'source', 'postgres_trigger_fast_path'
  );

  -- 7. Fire and Forget via pg_net
  PERFORM net.http_post(
    url := v_qstash_publish_url,
    body := v_body,
    headers := v_headers,
    timeout_milliseconds := 5000
  );

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Fast-path is an optimization; never block the main transaction.
    RAISE WARNING 'OCI Fast-Path Trigger failed: %', SQLERRM;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.notify_oci_runner_fast_path() IS 'Real-time OCI wakeup signal. POSTs a blind ping to QStash targeting the Google Ads worker, with 1-minute site-level deduplication.';

-- 2) Create the trigger (AFTER INSERT)
DROP TRIGGER IF EXISTS oci_fast_path_signal ON public.offline_conversion_queue;

CREATE TRIGGER oci_fast_path_signal
  AFTER INSERT ON public.offline_conversion_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_oci_runner_fast_path();

COMMENT ON TRIGGER oci_fast_path_signal ON public.offline_conversion_queue IS 'Fires a real-time wakeup ping to the OCI runner via QStash on every new conversion enqueue.';

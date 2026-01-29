-- =============================================================================
-- PHASE 2 — Hunter AI: Trigger/Webhook setup (STEP 2)
-- Date: 2026-01-29
--
-- When a high-intent row is INSERTed into calls (source='click', intent_action
-- in ('phone','whatsapp')), this trigger POSTs the new row to the hunter-ai
-- Edge Function via pg_net. The Edge Function will fetch session + timeline
-- (get_session_timeline RPC), call OpenAI/Gemini, and UPDATE sessions.ai_*.
--
-- Prerequisites:
-- 1. Enable "pg_net" in Supabase Dashboard → Database → Extensions.
-- 2. private.api_keys tablosuna project_url ve service_role_key ekle (SQL Editor'da manuel):
--      INSERT INTO private.api_keys (key_name, key_value) VALUES
--        ('project_url', 'https://SENIN-PROJE-REF.supabase.co'),
--        ('service_role_key', 'eyJ...SERVICE_ROLE_KEY...')
--      ON CONFLICT (key_name) DO UPDATE SET key_value = EXCLUDED.key_value;
-- 3. Deploy hunter-ai Edge Function: supabase functions deploy hunter-ai
-- =============================================================================

-- Trigger function: on high-intent call insert, POST to hunter-ai Edge Function (reads from private.api_keys).
CREATE OR REPLACE FUNCTION public.trigger_calls_notify_hunter_ai()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, net, extensions
AS $$
DECLARE
  v_url text;
  v_key text;
  v_headers jsonb;
  v_body jsonb;
BEGIN
  -- Only high-intent: source = 'click' and intent_action in ('phone', 'whatsapp')
  IF NEW.source IS DISTINCT FROM 'click' OR NEW.intent_action IS NULL OR NEW.intent_action NOT IN ('phone', 'whatsapp') THEN
    RETURN NEW;
  END IF;

  -- private.api_keys tablosundan oku (Vault yerine)
  SELECT key_value INTO v_url FROM private.api_keys WHERE key_name = 'project_url';
  SELECT key_value INTO v_key FROM private.api_keys WHERE key_name = 'service_role_key';
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE NOTICE 'hunter_ai: project_url or service_role_key missing in private.api_keys; skipping.';
    RETURN NEW;
  END IF;

  v_url := rtrim(v_url, '/') || '/functions/v1/hunter-ai';
  v_headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || v_key
  );
  v_body := jsonb_build_object(
    'type', 'INSERT',
    'table', 'calls',
    'record', to_jsonb(NEW)
  );

  PERFORM net.http_post(
    url := v_url,
    body := v_body,
    params := '{}'::jsonb,
    headers := v_headers,
    timeout_milliseconds := 10000
  );

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'hunter_ai trigger hatası: %', SQLERRM;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trigger_calls_notify_hunter_ai() IS 'On high-intent call insert, POST to hunter-ai Edge Function via pg_net. Reads project_url and service_role_key from private.api_keys.';

-- Drop trigger if it exists (idempotent)
DROP TRIGGER IF EXISTS calls_notify_hunter_ai ON public.calls;

-- After insert on calls: notify hunter-ai Edge Function for high-intent rows only.
CREATE TRIGGER calls_notify_hunter_ai
  AFTER INSERT ON public.calls
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_calls_notify_hunter_ai();

COMMENT ON TRIGGER calls_notify_hunter_ai ON public.calls IS 'POST new high-intent call (source=click, intent_action in phone/whatsapp) to hunter-ai Edge Function.';

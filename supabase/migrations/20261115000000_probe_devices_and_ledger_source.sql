-- OpsMantik Probe (Android Edge-Node): device registration and ledger event source
-- See: Probe brifing (POST /api/intents/status, by-phone, seal with signature)

-- 1) probe_devices: store device public keys for ECDSA signature verification
CREATE TABLE IF NOT EXISTS public.probe_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  device_id text NOT NULL,
  public_key_pem text NOT NULL,
  registered_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  UNIQUE(site_id, device_id)
);

COMMENT ON TABLE public.probe_devices IS 'Probe (Android) devices per site; public key for ECDSA verification of intent/seal payloads.';
CREATE INDEX IF NOT EXISTS idx_probe_devices_site ON public.probe_devices(site_id);

-- RLS: only service_role and site owners/admins can manage (API uses adminClient for registration lookup)
ALTER TABLE public.probe_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY probe_devices_service ON public.probe_devices FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 2) call_funnel_ledger: add PROBE to event_source CHECK (only if table exists from 20261110000000)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'call_funnel_ledger') THEN
    ALTER TABLE public.call_funnel_ledger
      DROP CONSTRAINT IF EXISTS call_funnel_ledger_event_source_check;
    ALTER TABLE public.call_funnel_ledger
      ADD CONSTRAINT call_funnel_ledger_event_source_check
      CHECK (event_source IN ('TRACK','SYNC','CALL_EVENT','OUTBOX_CRON','SEAL_ROUTE','WORKER','REPAIR','PROBE'));
  END IF;
END $$;

-- 3) RPC: create a minimal call row for Probe-originated intents (no session)
CREATE OR REPLACE FUNCTION public.create_probe_call_v1(
  p_site_id uuid,
  p_intent_target text,
  p_idempotency_suffix text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stamp text;
  v_id uuid;
BEGIN
  IF p_site_id IS NULL OR NULLIF(BTRIM(p_intent_target), '') IS NULL OR NULLIF(BTRIM(p_idempotency_suffix), '') IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'invalid_params', ERRCODE = 'P0001';
  END IF;
  v_stamp := 'probe:' || BTRIM(p_intent_target) || ':' || BTRIM(p_idempotency_suffix);

  INSERT INTO public.calls (
    site_id,
    phone_number,
    matched_session_id,
    matched_fingerprint,
    lead_score,
    lead_score_at_match,
    status,
    source,
    intent_stamp,
    intent_action,
    intent_target,
    intent_phone_clicks,
    intent_whatsapp_clicks,
    intent_last_at
  )
  VALUES (
    p_site_id,
    COALESCE(NULLIF(BTRIM(p_intent_target), ''), 'Unknown'),
    NULL,
    NULL,
    0,
    0,
    'intent',
    'api',
    v_stamp,
    'phone',
    NULLIF(BTRIM(p_intent_target), ''),
    1,
    0,
    now()
  )
  ON CONFLICT (site_id, intent_stamp) DO UPDATE SET intent_last_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
COMMENT ON FUNCTION public.create_probe_call_v1(uuid, text, text) IS 'Creates or returns existing call for Probe V4 intent when no web click exists.';
REVOKE ALL ON FUNCTION public.create_probe_call_v1(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_probe_call_v1(uuid, text, text) TO service_role;

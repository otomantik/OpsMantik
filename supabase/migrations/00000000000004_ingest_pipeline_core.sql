BEGIN;

-- Big Bang baseline (00000000000000) ships raw_signals/leads but the app ingest worker
-- still expects legacy core tables. This migration adds the minimum shape so /api/sync → worker can persist.

CREATE TABLE IF NOT EXISTS public.processed_signals (
  event_id uuid NOT NULL,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id)
);

CREATE INDEX IF NOT EXISTS idx_processed_signals_site ON public.processed_signals(site_id);

CREATE TABLE IF NOT EXISTS public.sessions (
  id uuid NOT NULL,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  created_month date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  ip_address text,
  user_agent text,
  gclid text,
  wbraid text,
  gbraid text,
  entry_page text,
  exit_page text,
  total_duration_sec integer,
  event_count integer,
  max_scroll_percentage integer,
  cta_hover_count integer,
  form_focus_duration integer,
  total_active_seconds integer,
  attribution_source text,
  traffic_source text,
  traffic_medium text,
  device_type text,
  device_os text,
  city text,
  district text,
  fingerprint text,
  utm_term text,
  matchtype text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_adgroup text,
  ads_network text,
  ads_placement text,
  ads_adposition text,
  device_model text,
  ads_target_id text,
  ads_feed_item_id text,
  loc_interest_ms text,
  loc_physical_ms text,
  telco_carrier text,
  browser text,
  isp_asn bigint,
  is_proxy_detected boolean,
  browser_language text,
  device_memory integer,
  hardware_concurrency integer,
  screen_width integer,
  screen_height integer,
  pixel_ratio numeric,
  gpu_renderer text,
  connection_type text,
  referrer_host text,
  is_returning boolean,
  visitor_rank text,
  previous_visit_count integer,
  consent_at timestamptz,
  consent_scopes text[],
  PRIMARY KEY (id, created_month)
);

CREATE INDEX IF NOT EXISTS idx_sessions_site_month ON public.sessions(site_id, created_month);
CREATE INDEX IF NOT EXISTS idx_sessions_fingerprint ON public.sessions(site_id, fingerprint, created_at);

CREATE TABLE IF NOT EXISTS public.events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  session_month date NOT NULL,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  event_category text,
  event_action text,
  event_label text,
  event_value numeric,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ingest_dedup_id uuid,
  consent_at timestamptz,
  consent_scopes text[],
  PRIMARY KEY (id, session_month)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_events_ingest_dedup_id ON public.events(ingest_dedup_id) WHERE ingest_dedup_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_session ON public.events(session_id, session_month);

CREATE TABLE IF NOT EXISTS public.calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  phone_number text NOT NULL,
  matched_session_id uuid,
  matched_fingerprint text,
  lead_score integer DEFAULT 0,
  matched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  status text DEFAULT 'intent',
  lead_score_at_match integer,
  score_breakdown jsonb,
  source text DEFAULT 'click',
  confirmed_at timestamptz,
  confirmed_by uuid,
  note text
);

CREATE INDEX IF NOT EXISTS idx_calls_session ON public.calls(matched_session_id);
CREATE INDEX IF NOT EXISTS idx_calls_site ON public.calls(site_id, created_at);

ALTER TABLE public.processed_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY processed_signals_service ON public.processed_signals
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE POLICY sessions_service ON public.sessions
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE POLICY events_service ON public.events
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE POLICY calls_service ON public.calls
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- Minimal intent RPC used by IntentService.handleIntent
CREATE OR REPLACE FUNCTION public.ensure_session_intent_v1(
  p_site_id uuid,
  p_session_id uuid,
  p_fingerprint text,
  p_lead_score integer,
  p_intent_action text,
  p_intent_target text,
  p_intent_page_url text,
  p_click_id text,
  p_form_state text DEFAULT NULL,
  p_form_summary jsonb DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid := gen_random_uuid();
  v_phone text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role required' USING ERRCODE = 'P0001';
  END IF;

  v_phone := COALESCE(NULLIF(trim(p_intent_target), ''), 'unknown');
  IF length(v_phone) > 512 THEN
    v_phone := left(v_phone, 512);
  END IF;

  INSERT INTO public.calls (
    id,
    site_id,
    phone_number,
    matched_session_id,
    matched_fingerprint,
    lead_score,
    source,
    status,
    created_at,
    matched_at
  ) VALUES (
    v_id,
    p_site_id,
    v_phone,
    p_session_id,
    p_fingerprint,
    COALESCE(p_lead_score, 0),
    'click',
    'intent',
    now(),
    now()
  );

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_session_intent_v1(
  uuid, uuid, text, integer, text, text, text, text, text, jsonb
) TO service_role;

COMMIT;

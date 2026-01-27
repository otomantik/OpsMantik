-- Migration: Intent Ratio Watchdog (Ads Command Center)
-- Date: 2026-01-28
--
-- Purpose:
-- Provide a cheap acceptance metric to detect class of failures where
-- phone/whatsapp clicks are recorded but call intents are not created.
--
-- Metric:
--   ratio = click_intents_ads_only / phone_events_anycat_ads_only
--
-- Notes:
-- - Partition-friendly: uses sessions.created_month and events.session_month bounds
-- - Cheap: filters to phone/wa actions only; avoids scanning all events
-- - Server-side Ads-only: uses public.is_ads_session(public.sessions)

BEGIN;

CREATE OR REPLACE FUNCTION public.get_intent_ratio_watchdog(
  p_site_id uuid,
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_ads_only boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_start_month date;
  v_end_month date;
  v_phone_events int;
  v_click_intents int;
  v_ratio numeric;
BEGIN
  PERFORM validate_date_range(p_date_from, p_date_to);

  v_start_month := DATE_TRUNC('month', p_date_from)::date;
  v_end_month := DATE_TRUNC('month', p_date_to)::date + INTERVAL '1 month';

  -- Scope sessions first (partition-friendly) then join events using session_id+session_month
  WITH s_scope AS (
    SELECT s.id, s.created_month
    FROM public.sessions s
    WHERE s.site_id = p_site_id
      AND s.created_month >= v_start_month
      AND s.created_month < v_end_month
      AND s.created_at >= p_date_from
      AND s.created_at <= p_date_to
      AND (p_ads_only = false OR public.is_ads_session(s))
  )
  SELECT COUNT(*)::int INTO v_phone_events
  FROM public.events e
  JOIN s_scope s ON e.session_id = s.id AND e.session_month = s.created_month
  WHERE e.session_month >= v_start_month
    AND e.session_month < v_end_month
    AND e.created_at >= p_date_from
    AND e.created_at <= p_date_to
    AND e.event_action IN ('phone_call', 'whatsapp', 'phone_click', 'call_click');

  -- Click intents matched to scoped sessions (ads-only correctness)
  WITH s_scope AS (
    SELECT s.id
    FROM public.sessions s
    WHERE s.site_id = p_site_id
      AND s.created_month >= v_start_month
      AND s.created_month < v_end_month
      AND s.created_at >= p_date_from
      AND s.created_at <= p_date_to
      AND (p_ads_only = false OR public.is_ads_session(s))
  )
  SELECT COUNT(*)::int INTO v_click_intents
  FROM public.calls c
  WHERE c.site_id = p_site_id
    AND c.created_at >= p_date_from
    AND c.created_at <= p_date_to
    AND c.source = 'click'
    AND (c.status = 'intent' OR c.status IS NULL)
    AND (
      p_ads_only = false
      OR EXISTS (SELECT 1 FROM s_scope s WHERE s.id = c.matched_session_id)
    );

  IF v_phone_events > 0 THEN
    v_ratio := ROUND((v_click_intents::numeric / v_phone_events::numeric), 4);
  ELSE
    v_ratio := NULL;
  END IF;

  RETURN jsonb_build_object(
    'site_id', p_site_id,
    'date_from', p_date_from,
    'date_to', p_date_to,
    'ads_only', p_ads_only,
    'phone_events_anycat_ads_only', v_phone_events,
    'click_intents_ads_only', v_click_intents,
    'ratio', v_ratio
  );
END;
$$;

COMMENT ON FUNCTION public.get_intent_ratio_watchdog(uuid, timestamptz, timestamptz, boolean)
IS 'Acceptance metric: ratio=click_intents_ads_only/phone_events_anycat_ads_only for a date range (Ads Command Center).';

GRANT EXECUTE ON FUNCTION public.get_intent_ratio_watchdog(uuid, timestamptz, timestamptz, boolean) TO anon, authenticated, service_role;

COMMIT;


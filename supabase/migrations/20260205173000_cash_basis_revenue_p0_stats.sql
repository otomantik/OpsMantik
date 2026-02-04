-- Command Center P0 Stats v2: Cash-basis revenue (confirmed_at)
--
-- Requirement:
-- - Keep lead / capture metrics based on calls.created_at (how many leads came in the selected range)
-- - CRITICAL: projected_revenue must sum sale_amount where calls.confirmed_at is within [p_date_from, p_date_to)
--   regardless of when the lead (call) was created.
--
-- Notes:
-- - Retains zombie-session filtering from 20260205170000_filter_invalid_zombie_traffic_p0_stats.sql
-- - Revenue is NOT filtered by session validity; it is filtered by p_ads_only (when enabled).

BEGIN;

CREATE OR REPLACE FUNCTION public.get_command_center_p0_stats_v2(
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
  v_total_sessions int;
  v_pending int;
  v_sealed int;
  v_junk int;
  v_auto_approved int;
  v_oci_uploaded int;
  v_oci_failed int;
  v_oci_matchable_sealed int;
  v_assumed_cpc numeric;
  v_currency text;
  v_revenue numeric;

  -- Enterprise Metrics (funnel)
  v_total_leads int;
  v_gclid_leads int;
  v_avg_scroll numeric;
BEGIN
  PERFORM validate_date_range(p_date_from, p_date_to);

  v_start_month := DATE_TRUNC('month', p_date_from)::date;
  v_end_month := (DATE_TRUNC('month', p_date_to)::date + INTERVAL '1 month')::date;

  SELECT COALESCE(s.assumed_cpc, 0), COALESCE(s.currency, 'TRY')
  INTO v_assumed_cpc, v_currency
  FROM public.sites s
  WHERE s.id = p_site_id;

  -- Valid sessions: exclude zombie traffic (0 events OR <2 seconds)
  WITH valid_sessions AS (
    SELECT s.id
    FROM public.sessions s
    WHERE s.site_id = p_site_id
      AND s.created_month >= v_start_month
      AND s.created_month < v_end_month
      AND s.created_at >= p_date_from
      AND s.created_at < p_date_to
      AND COALESCE(s.event_count, 0) > 0
      AND COALESCE(s.total_duration_sec, 0) >= 2
      AND (p_ads_only = false OR public.is_ads_session(s))
  )
  SELECT COUNT(*)::int INTO v_total_sessions FROM valid_sessions;

  -- Incoming intents (Total Leads): count intents tied to valid sessions.
  -- Edge-case protection: if a call is sealed, count it even if session is zombie.
  WITH valid_sessions AS (
    SELECT s.id
    FROM public.sessions s
    WHERE s.site_id = p_site_id
      AND s.created_month >= v_start_month
      AND s.created_month < v_end_month
      AND s.created_at >= p_date_from
      AND s.created_at < p_date_to
      AND COALESCE(s.event_count, 0) > 0
      AND COALESCE(s.total_duration_sec, 0) >= 2
      AND (p_ads_only = false OR public.is_ads_session(s))
  )
  SELECT COUNT(*)::int INTO v_total_leads
  FROM public.calls c
  LEFT JOIN public.sessions s ON s.id = c.matched_session_id AND s.site_id = p_site_id
  WHERE c.site_id = p_site_id
    AND c.source = 'click'
    AND c.created_at >= p_date_from
    AND c.created_at < p_date_to
    AND (
      EXISTS (SELECT 1 FROM valid_sessions vs WHERE vs.id = c.matched_session_id)
      OR c.status IN ('confirmed','qualified','real')
    )
    AND (
      p_ads_only = false
      OR (s.id IS NOT NULL AND public.is_ads_session(s))
    );

  -- GCLID Leads (Ads-verified leads): same validity rule as total_leads
  WITH valid_sessions AS (
    SELECT s.id
    FROM public.sessions s
    WHERE s.site_id = p_site_id
      AND s.created_month >= v_start_month
      AND s.created_month < v_end_month
      AND s.created_at >= p_date_from
      AND s.created_at < p_date_to
      AND COALESCE(s.event_count, 0) > 0
      AND COALESCE(s.total_duration_sec, 0) >= 2
      AND (p_ads_only = false OR public.is_ads_session(s))
  )
  SELECT COUNT(*)::int INTO v_gclid_leads
  FROM public.calls c
  LEFT JOIN public.sessions s ON s.id = c.matched_session_id AND s.site_id = p_site_id
  WHERE c.site_id = p_site_id
    AND c.source = 'click'
    AND c.created_at >= p_date_from
    AND c.created_at < p_date_to
    AND (
      COALESCE(NULLIF(BTRIM(c.click_id), ''), NULL) IS NOT NULL
      OR COALESCE(NULLIF(BTRIM(s.gclid), ''), NULL) IS NOT NULL
      OR COALESCE(NULLIF(BTRIM(s.wbraid), ''), NULL) IS NOT NULL
      OR COALESCE(NULLIF(BTRIM(s.gbraid), ''), NULL) IS NOT NULL
    )
    AND (
      EXISTS (SELECT 1 FROM valid_sessions vs WHERE vs.id = c.matched_session_id)
      OR c.status IN ('confirmed','qualified','real')
    )
    AND (
      p_ads_only = false
      OR (s.id IS NOT NULL AND public.is_ads_session(s))
    );

  -- Avg Scroll Depth: compute over valid sessions
  SELECT COALESCE(AVG(s.max_scroll_percentage), 0)::numeric INTO v_avg_scroll
  FROM public.sessions s
  WHERE s.site_id = p_site_id
    AND s.created_month >= v_start_month
    AND s.created_month < v_end_month
    AND s.created_at >= p_date_from
    AND s.created_at < p_date_to
    AND COALESCE(s.event_count, 0) > 0
    AND COALESCE(s.total_duration_sec, 0) >= 2
    AND (
      p_ads_only = false
      OR public.is_ads_session(s)
    );

  -- Pending queue: only intents tied to valid sessions
  WITH valid_sessions AS (
    SELECT s.id
    FROM public.sessions s
    WHERE s.site_id = p_site_id
      AND s.created_month >= v_start_month
      AND s.created_month < v_end_month
      AND s.created_at >= p_date_from
      AND s.created_at < p_date_to
      AND COALESCE(s.event_count, 0) > 0
      AND COALESCE(s.total_duration_sec, 0) >= 2
      AND (p_ads_only = false OR public.is_ads_session(s))
  )
  SELECT COUNT(*)::int INTO v_pending
  FROM public.calls c
  LEFT JOIN public.sessions s ON s.id = c.matched_session_id AND s.site_id = p_site_id
  WHERE c.site_id = p_site_id
    AND c.source = 'click'
    AND (c.status = 'intent' OR c.status IS NULL)
    AND c.created_at >= p_date_from
    AND c.created_at < p_date_to
    AND EXISTS (SELECT 1 FROM valid_sessions vs WHERE vs.id = c.matched_session_id)
    AND (
      p_ads_only = false
      OR (s.id IS NOT NULL AND public.is_ads_session(s))
    );

  -- Sealed count (created_at basis; not filtered by session validity)
  SELECT COUNT(*)::int
  INTO v_sealed
  FROM public.calls c
  LEFT JOIN public.sessions s ON s.id = c.matched_session_id AND s.site_id = p_site_id
  WHERE c.site_id = p_site_id
    AND c.source = 'click'
    AND c.status IN ('confirmed','qualified','real')
    AND c.created_at >= p_date_from
    AND c.created_at < p_date_to
    AND (
      p_ads_only = false
      OR (s.id IS NOT NULL AND public.is_ads_session(s))
    );

  -- Revenue projection (cash basis): confirmed_at within [from, to) regardless of created_at
  SELECT SUM(COALESCE(c.sale_amount, 0))::numeric
  INTO v_revenue
  FROM public.calls c
  LEFT JOIN public.sessions s ON s.id = c.matched_session_id AND s.site_id = p_site_id
  WHERE c.site_id = p_site_id
    AND c.source = 'click'
    AND c.status IN ('confirmed','qualified','real')
    AND c.confirmed_at >= p_date_from
    AND c.confirmed_at < p_date_to
    AND (
      p_ads_only = false
      OR (s.id IS NOT NULL AND public.is_ads_session(s))
    );

  -- Junk: keep as-is (not validity-filtered; it's an operator action)
  SELECT COUNT(*)::int INTO v_junk
  FROM public.calls c
  LEFT JOIN public.sessions s ON s.id = c.matched_session_id AND s.site_id = p_site_id
  WHERE c.site_id = p_site_id
    AND c.source = 'click'
    AND c.status = 'junk'
    AND c.created_at >= p_date_from
    AND c.created_at < p_date_to
    AND (
      p_ads_only = false
      OR (s.id IS NOT NULL AND public.is_ads_session(s))
    );

  -- Auto-approved (subset of sealed): keep as-is
  SELECT COUNT(*)::int INTO v_auto_approved
  FROM public.calls c
  WHERE c.site_id = p_site_id
    AND c.source = 'click'
    AND c.status = 'confirmed'
    AND c.created_at >= p_date_from
    AND c.created_at < p_date_to
    AND (c.score_breakdown->>'auto_approved')::boolean IS TRUE;

  -- OCI pipeline counts (unchanged)
  SELECT
    COUNT(*) FILTER (WHERE c.oci_status = 'uploaded')::int,
    COUNT(*) FILTER (WHERE c.oci_status = 'failed')::int
  INTO v_oci_uploaded, v_oci_failed
  FROM public.calls c
  WHERE c.site_id = p_site_id
    AND c.source = 'click'
    AND c.created_at >= p_date_from
    AND c.created_at < p_date_to;

  -- Matchable sealed (unchanged)
  SELECT COUNT(*)::int INTO v_oci_matchable_sealed
  FROM public.calls c
  JOIN public.sessions s ON s.id = c.matched_session_id AND s.site_id = p_site_id
  WHERE c.site_id = p_site_id
    AND c.source = 'click'
    AND c.status IN ('confirmed','qualified','real')
    AND c.created_at >= p_date_from
    AND c.created_at < p_date_to
    AND public.is_ads_session(s)
    AND (
      COALESCE(NULLIF(BTRIM(c.click_id), ''), NULL) IS NOT NULL
      OR COALESCE(NULLIF(BTRIM(s.gclid), ''), NULL) IS NOT NULL
      OR COALESCE(NULLIF(BTRIM(s.wbraid), ''), NULL) IS NOT NULL
      OR COALESCE(NULLIF(BTRIM(s.gbraid), ''), NULL) IS NOT NULL
    );

  RETURN jsonb_build_object(
    'site_id', p_site_id,
    'date_from', p_date_from,
    'date_to', p_date_to,
    'ads_only', p_ads_only,

    'total_sessions', COALESCE(v_total_sessions, 0),
    'queue_pending', COALESCE(v_pending, 0),
    'sealed', COALESCE(v_sealed, 0),
    'junk', COALESCE(v_junk, 0),
    'auto_approved', COALESCE(v_auto_approved, 0),

    'oci_uploaded', COALESCE(v_oci_uploaded, 0),
    'oci_failed', COALESCE(v_oci_failed, 0),
    'oci_matchable_sealed', COALESCE(v_oci_matchable_sealed, 0),

    'assumed_cpc', COALESCE(v_assumed_cpc, 0),
    'currency', v_currency,
    'estimated_budget_saved', ROUND(COALESCE(v_junk, 0)::numeric * COALESCE(v_assumed_cpc, 0), 2),
    'projected_revenue', COALESCE(v_revenue, 0),

    -- Leads came in (created_at basis)
    'total_leads', COALESCE(v_total_leads, 0),
    'incoming_intents', COALESCE(v_total_leads, 0),
    'gclid_leads', COALESCE(v_gclid_leads, 0),
    'avg_scroll_depth', ROUND(COALESCE(v_avg_scroll, 0), 1),

    'inbox_zero_now', (COALESCE(v_pending, 0) = 0)
  );
END;
$$;

COMMIT;


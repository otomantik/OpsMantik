-- Migration: Enterprise Analytics v2 - Advanced Lead Metrics
-- Date: 2026-02-01

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
  
  -- New Enterprise Metrics
  v_total_leads int;
  v_gclid_leads int;
  v_avg_scroll numeric;
BEGIN
  PERFORM validate_date_range(p_date_from, p_date_to);

  v_start_month := DATE_TRUNC('month', p_date_from)::date;
  v_end_month := DATE_TRUNC('month', p_date_to)::date + INTERVAL '1 month';

  SELECT COALESCE(s.assumed_cpc, 0), COALESCE(s.currency, 'TRY')
  INTO v_assumed_cpc, v_currency
  FROM public.sites s
  WHERE s.id = p_site_id;

  -- Total Leads (All intents in range)
  SELECT COUNT(*)::int INTO v_total_leads
  FROM public.calls c
  WHERE c.site_id = p_site_id
    AND c.source = 'click'
    AND c.created_at >= p_date_from
    AND c.created_at < p_date_to
    AND (
      p_ads_only = false
      OR EXISTS (
        SELECT 1 FROM public.sessions s
        WHERE s.id = c.matched_session_id
          AND s.site_id = p_site_id
          AND public.is_ads_session(s)
      )
    );

  -- GCLID Leads (Ads-verified leads)
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
      p_ads_only = false
      OR (s.id IS NOT NULL AND public.is_ads_session(s))
    );

  -- Avg Scroll Depth
  SELECT COALESCE(AVG(s.max_scroll_percentage), 0)::numeric INTO v_avg_scroll
  FROM public.calls c
  JOIN public.sessions s ON s.id = c.matched_session_id AND s.site_id = p_site_id
  WHERE c.site_id = p_site_id
    AND c.source = 'click'
    AND c.created_at >= p_date_from
    AND c.created_at < p_date_to
    AND (
      p_ads_only = false
      OR public.is_ads_session(s)
    );

  -- Pending queue
  SELECT COUNT(*)::int INTO v_pending
  FROM public.calls c
  WHERE c.site_id = p_site_id
    AND c.source = 'click'
    AND (c.status = 'intent' OR c.status IS NULL)
    AND c.created_at >= p_date_from
    AND c.created_at < p_date_to
    AND (
      p_ads_only = false
      OR EXISTS (
        SELECT 1 FROM public.sessions s
        WHERE s.id = c.matched_session_id
          AND s.site_id = p_site_id
          AND public.is_ads_session(s)
      )
    );

  -- Sealed today
  SELECT 
    COUNT(*)::int,
    SUM(COALESCE(c.sale_amount, 0))::numeric
  INTO v_sealed, v_revenue
  FROM public.calls c
  WHERE c.site_id = p_site_id
    AND c.source = 'click'
    AND c.status IN ('confirmed','qualified','real')
    AND c.created_at >= p_date_from
    AND c.created_at < p_date_to
    AND (
      p_ads_only = false
      OR EXISTS (
        SELECT 1 FROM public.sessions s
        WHERE s.id = c.matched_session_id
          AND s.site_id = p_site_id
          AND public.is_ads_session(s)
      )
    );

  -- Junk today
  SELECT COUNT(*)::int INTO v_junk
  FROM public.calls c
  WHERE c.site_id = p_site_id
    AND c.source = 'click'
    AND c.status = 'junk'
    AND c.created_at >= p_date_from
    AND c.created_at < p_date_to
    AND (
      p_ads_only = false
      OR EXISTS (
        SELECT 1 FROM public.sessions s
        WHERE s.id = c.matched_session_id
          AND s.site_id = p_site_id
          AND public.is_ads_session(s)
      )
    );

  -- Auto-approved
  SELECT COUNT(*)::int INTO v_auto_approved
  FROM public.calls c
  WHERE c.site_id = p_site_id
    AND c.source = 'click'
    AND c.status = 'confirmed'
    AND c.created_at >= p_date_from
    AND c.created_at < p_date_to
    AND (c.score_breakdown->>'auto_approved')::boolean IS TRUE;

  -- OCI pipeline counts
  SELECT
    COUNT(*) FILTER (WHERE c.oci_status = 'uploaded')::int,
    COUNT(*) FILTER (WHERE c.oci_status = 'failed')::int
  INTO v_oci_uploaded, v_oci_failed
  FROM public.calls c
  WHERE c.site_id = p_site_id
    AND c.source = 'click'
    AND c.created_at >= p_date_from
    AND c.created_at < p_date_to;

  -- Matchable sealed
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

    -- New metrics
    'total_leads', COALESCE(v_total_leads, 0),
    'gclid_leads', COALESCE(v_gclid_leads, 0),
    'avg_scroll_depth', ROUND(COALESCE(v_avg_scroll, 0), 1),

    'inbox_zero_now', (COALESCE(v_pending, 0) = 0)
  );
END;
$$;

COMMIT;

-- Migration: P0 - OCI feedback loop + auto-approve + gamification stats
-- Date: 2026-01-29
--
-- Adds:
-- - public.calls: OCI pipeline fields (oci_status, timestamps, batch id, error)
-- - public.sites: per-site estimation knobs (assumed_cpc, currency)
-- - public.get_recent_intents_v1: enrich rows with risk reasons + OCI fields
-- - public.auto_approve_stale_intents_v1: unblock human bottleneck (24h window, low-risk only)
-- - public.get_command_center_p0_stats_v1: dashboard helper for gamification + pipeline counts
BEGIN;

-- 1) Per-site KPI knobs (for "budget saved" estimation)
ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS assumed_cpc numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS currency text DEFAULT 'TRY';

COMMENT ON COLUMN public.sites.assumed_cpc IS 'Optional: assumed cost per click/intent (in site currency) used for budget-saved estimation.';
COMMENT ON COLUMN public.sites.currency IS 'Currency code for UI/exports (default TRY).';

-- 2) OCI pipeline state on calls (best-effort; uploader can evolve later)
ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS oci_status text,
  ADD COLUMN IF NOT EXISTS oci_status_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS oci_uploaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS oci_matched_at timestamptz,
  ADD COLUMN IF NOT EXISTS oci_batch_id uuid,
  ADD COLUMN IF NOT EXISTS oci_error text;

COMMENT ON COLUMN public.calls.oci_status IS 'OCI pipeline status: sealed|uploading|uploaded|failed|skipped (optional).';
COMMENT ON COLUMN public.calls.oci_batch_id IS 'OCI batch identifier (export/upload grouping).';
COMMENT ON COLUMN public.calls.oci_error IS 'Last OCI pipeline error (if any).';

CREATE INDEX IF NOT EXISTS idx_calls_site_oci_status_created_at
  ON public.calls(site_id, oci_status, created_at DESC);

-- 3) Enrich Live Inbox RPC with risk reasons + OCI fields (no extra joins beyond sessions)
CREATE OR REPLACE FUNCTION public.get_recent_intents_v1(
  p_site_id uuid,
  p_since timestamptz DEFAULT NULL,
  p_minutes_lookback int DEFAULT 60,
  p_limit int DEFAULT 200,
  p_ads_only boolean DEFAULT true
)
RETURNS jsonb[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_role text;
  v_limit int;
  v_since timestamptz;
BEGIN
  v_user_id := auth.uid();
  v_role := auth.role();

  -- Auth: allow authenticated users; service_role permitted for smoke/scripts
  IF v_user_id IS NULL THEN
    IF v_role IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION USING
        MESSAGE = 'not_authenticated',
        DETAIL = 'User must be authenticated',
        ERRCODE = 'P0001';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1
      FROM public.sites s
      WHERE s.id = p_site_id
        AND (
          s.user_id = v_user_id
          OR EXISTS (
            SELECT 1 FROM public.site_members sm
            WHERE sm.site_id = s.id AND sm.user_id = v_user_id
          )
          OR public.is_admin(v_user_id)
        )
    ) THEN
      RAISE EXCEPTION USING
        MESSAGE = 'access_denied',
        DETAIL = 'Access denied to this site',
        ERRCODE = 'P0001';
    END IF;
  END IF;

  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 200), 500));
  v_since := COALESCE(
    p_since,
    now() - make_interval(mins => GREATEST(1, LEAST(COALESCE(p_minutes_lookback, 60), 24 * 60)))
  );

  RETURN (
    SELECT COALESCE(
      ARRAY(
        SELECT jsonb_build_object(
          'id', c.id,
          'created_at', c.created_at,
          'intent_action', c.intent_action,
          'intent_target', c.intent_target,
          'intent_stamp', c.intent_stamp,
          'intent_page_url', c.intent_page_url,
          'matched_session_id', c.matched_session_id,
          'lead_score', c.lead_score,
          'status', c.status,
          'click_id', c.click_id,

          -- OCI feedback fields
          'oci_status', c.oci_status,
          'oci_status_updated_at', c.oci_status_updated_at,
          'oci_uploaded_at', c.oci_uploaded_at,
          'oci_batch_id', c.oci_batch_id,
          'oci_error', c.oci_error,

          -- Session enrichment (lightweight join already used for ads-only gating)
          'attribution_source', s.attribution_source,
          'gclid', s.gclid,
          'wbraid', s.wbraid,
          'gbraid', s.gbraid,
          'total_duration_sec', s.total_duration_sec,
          'event_count', s.event_count,

          -- Risk & Matchability (simple, explainable)
          'oci_matchable', (
            COALESCE(NULLIF(BTRIM(c.click_id), ''), NULL) IS NOT NULL
            OR COALESCE(NULLIF(BTRIM(s.gclid), ''), NULL) IS NOT NULL
            OR COALESCE(NULLIF(BTRIM(s.wbraid), ''), NULL) IS NOT NULL
            OR COALESCE(NULLIF(BTRIM(s.gbraid), ''), NULL) IS NOT NULL
          ),
          'risk_reasons', to_jsonb(array_remove(ARRAY[
            CASE
              WHEN (COALESCE(NULLIF(BTRIM(c.click_id), ''), NULL) IS NULL)
                AND (COALESCE(NULLIF(BTRIM(s.gclid), ''), NULL) IS NULL)
                AND (COALESCE(NULLIF(BTRIM(s.wbraid), ''), NULL) IS NULL)
                AND (COALESCE(NULLIF(BTRIM(s.gbraid), ''), NULL) IS NULL)
              THEN 'High Risk: Click ID yok (GCLID/WBRAID/GBRAID bulunamadı)'
            END,
            CASE
              WHEN s.total_duration_sec IS NOT NULL AND s.total_duration_sec <= 3
              THEN 'High Risk: Sitede 3 saniye (veya daha az) kaldı'
            END,
            CASE
              WHEN s.event_count IS NOT NULL AND s.event_count <= 1
              THEN 'High Risk: Tek etkileşim (event_count<=1)'
            END,
            CASE
              WHEN s.attribution_source IS NOT NULL AND LOWER(s.attribution_source) LIKE '%organic%'
              THEN 'High Risk: Attribution Organic görünüyor'
            END
          ], NULL)),
          'risk_level', CASE
            WHEN (
              (COALESCE(NULLIF(BTRIM(c.click_id), ''), NULL) IS NULL)
              AND (COALESCE(NULLIF(BTRIM(s.gclid), ''), NULL) IS NULL)
              AND (COALESCE(NULLIF(BTRIM(s.wbraid), ''), NULL) IS NULL)
              AND (COALESCE(NULLIF(BTRIM(s.gbraid), ''), NULL) IS NULL)
            )
            OR (s.total_duration_sec IS NOT NULL AND s.total_duration_sec <= 3)
            OR (s.event_count IS NOT NULL AND s.event_count <= 1)
            THEN 'high'
            ELSE 'low'
          END,

          -- Display-only derived stage for UI (matches requested vocabulary)
          'oci_stage', CASE
            WHEN c.status IN ('confirmed','qualified','real') AND c.oci_status = 'uploaded'
              AND (
                COALESCE(NULLIF(BTRIM(c.click_id), ''), NULL) IS NOT NULL
                OR COALESCE(NULLIF(BTRIM(s.gclid), ''), NULL) IS NOT NULL
                OR COALESCE(NULLIF(BTRIM(s.wbraid), ''), NULL) IS NOT NULL
                OR COALESCE(NULLIF(BTRIM(s.gbraid), ''), NULL) IS NOT NULL
              )
            THEN 'matched'
            WHEN c.status IN ('confirmed','qualified','real') AND c.oci_status = 'uploaded' THEN 'uploaded'
            WHEN c.status IN ('confirmed','qualified','real') THEN 'sealed'
            ELSE 'pending'
          END
        )
        FROM public.calls c
        LEFT JOIN public.sessions s
          ON s.id = c.matched_session_id
         AND s.site_id = p_site_id
        WHERE c.site_id = p_site_id
          AND c.source = 'click'
          AND (c.status IN ('intent','confirmed','junk') OR c.status IS NULL)
          AND c.created_at >= v_since
          AND (
            p_ads_only = false
            OR (
              s.id IS NOT NULL
              AND public.is_ads_session(s)
            )
          )
        ORDER BY c.created_at DESC, c.id DESC
        LIMIT v_limit
      ),
      ARRAY[]::jsonb[]
    )
  );
END;
$$;

COMMENT ON FUNCTION public.get_recent_intents_v1(uuid, timestamptz, int, int, boolean)
IS 'Live Inbox RPC: recent click intents from calls (fast). Enriched with risk reasons and OCI pipeline fields.';

REVOKE ALL ON FUNCTION public.get_recent_intents_v1(uuid, timestamptz, int, int, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_recent_intents_v1(uuid, timestamptz, int, int, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_recent_intents_v1(uuid, timestamptz, int, int, boolean) TO service_role;

-- 4) Auto-approve stale intents (human bottleneck safety valve)
-- Low-risk definition (conservative):
-- - Ads click-id present (gclid/wbraid/gbraid)
-- - session has >= 10s duration
-- - session has >= 2 events
CREATE OR REPLACE FUNCTION public.auto_approve_stale_intents_v1(
  p_site_id uuid,
  p_min_age_hours int DEFAULT 24,
  p_limit int DEFAULT 200
)
RETURNS TABLE(call_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_role text;
  v_limit int;
  v_cutoff timestamptz;
BEGIN
  v_user_id := auth.uid();
  v_role := auth.role();

  -- Allow service_role (cron/scheduler) and authenticated callers with site access.
  IF v_user_id IS NULL THEN
    IF v_role IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION USING
        MESSAGE = 'not_authenticated',
        DETAIL = 'User must be authenticated',
        ERRCODE = 'P0001';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1
      FROM public.sites s
      WHERE s.id = p_site_id
        AND (
          s.user_id = v_user_id
          OR EXISTS (
            SELECT 1 FROM public.site_members sm
            WHERE sm.site_id = s.id AND sm.user_id = v_user_id
          )
          OR public.is_admin(v_user_id)
        )
    ) THEN
      RAISE EXCEPTION USING
        MESSAGE = 'access_denied',
        DETAIL = 'Access denied to this site',
        ERRCODE = 'P0001';
    END IF;
  END IF;

  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 200), 500));
  v_cutoff := now() - make_interval(hours => GREATEST(1, LEAST(COALESCE(p_min_age_hours, 24), 168)));

  RETURN QUERY
  WITH candidates AS (
    SELECT c.id
    FROM public.calls c
    JOIN public.sessions s
      ON s.id = c.matched_session_id
     AND s.site_id = p_site_id
    WHERE c.site_id = p_site_id
      AND c.source = 'click'
      AND (c.status = 'intent' OR c.status IS NULL)
      AND c.created_at < v_cutoff
      AND public.is_ads_session(s)
      AND (
        COALESCE(NULLIF(BTRIM(s.gclid), ''), NULL) IS NOT NULL
        OR COALESCE(NULLIF(BTRIM(s.wbraid), ''), NULL) IS NOT NULL
        OR COALESCE(NULLIF(BTRIM(s.gbraid), ''), NULL) IS NOT NULL
      )
      AND COALESCE(s.total_duration_sec, 0) >= 10
      AND COALESCE(s.event_count, 0) >= 2
    ORDER BY c.created_at ASC, c.id ASC
    LIMIT v_limit
  ),
  updated AS (
    UPDATE public.calls c
    SET
      status = 'confirmed',
      lead_score = GREATEST(COALESCE(c.lead_score, 0), 20),
      confirmed_at = now(),
      confirmed_by = NULL,
      note = COALESCE(NULLIF(c.note, ''), 'auto-approved after 24h (low-risk)'),
      score_breakdown = COALESCE(c.score_breakdown, '{}'::jsonb) || jsonb_build_object(
        'qualified_by', 'auto',
        'auto_approved', true,
        'min_age_hours', COALESCE(p_min_age_hours, 24),
        'timestamp', now()
      ),
      oci_status = 'sealed',
      oci_status_updated_at = now()
    FROM candidates x
    WHERE c.id = x.id
    RETURNING c.id
  )
  SELECT id FROM updated;
END;
$$;

COMMENT ON FUNCTION public.auto_approve_stale_intents_v1(uuid, int, int)
IS 'Auto-approve stale click intents after N hours (low-risk only) to prevent signal starvation.';

REVOKE ALL ON FUNCTION public.auto_approve_stale_intents_v1(uuid, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auto_approve_stale_intents_v1(uuid, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.auto_approve_stale_intents_v1(uuid, int, int) TO service_role;

-- 5) Dashboard helper: gamification + OCI pipeline stats (Today range is handled by caller)
CREATE OR REPLACE FUNCTION public.get_command_center_p0_stats_v1(
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
BEGIN
  PERFORM validate_date_range(p_date_from, p_date_to);

  v_start_month := DATE_TRUNC('month', p_date_from)::date;
  v_end_month := DATE_TRUNC('month', p_date_to)::date + INTERVAL '1 month';

  SELECT COALESCE(s.assumed_cpc, 0), COALESCE(s.currency, 'TRY')
  INTO v_assumed_cpc, v_currency
  FROM public.sites s
  WHERE s.id = p_site_id;

  -- Pending queue (unqualified intents)
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
        SELECT 1
        FROM public.sessions s
        WHERE s.site_id = p_site_id
          AND s.id = c.matched_session_id
          AND s.created_month >= v_start_month
          AND s.created_month < v_end_month
          AND s.created_at >= p_date_from
          AND s.created_at < p_date_to
          AND public.is_ads_session(s)
      )
    );

  -- Sealed today (manual or auto)
  SELECT COUNT(*)::int INTO v_sealed
  FROM public.calls c
  WHERE c.site_id = p_site_id
    AND c.source = 'click'
    AND c.status IN ('confirmed','qualified','real')
    AND c.created_at >= p_date_from
    AND c.created_at < p_date_to
    AND (
      p_ads_only = false
      OR EXISTS (
        SELECT 1
        FROM public.sessions s
        WHERE s.site_id = p_site_id
          AND s.id = c.matched_session_id
          AND s.created_month >= v_start_month
          AND s.created_month < v_end_month
          AND s.created_at >= p_date_from
          AND s.created_at < p_date_to
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
        SELECT 1
        FROM public.sessions s
        WHERE s.site_id = p_site_id
          AND s.id = c.matched_session_id
          AND s.created_month >= v_start_month
          AND s.created_month < v_end_month
          AND s.created_at >= p_date_from
          AND s.created_at < p_date_to
          AND public.is_ads_session(s)
      )
    );

  -- Auto-approved today (heuristic: score_breakdown.auto_approved = true)
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

  -- Matchable sealed (ready to upload / matchable)
  SELECT COUNT(*)::int INTO v_oci_matchable_sealed
  FROM public.calls c
  JOIN public.sessions s
    ON s.id = c.matched_session_id
   AND s.site_id = p_site_id
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

    'inbox_zero_now', (COALESCE(v_pending, 0) = 0)
  );
END;
$$;

COMMENT ON FUNCTION public.get_command_center_p0_stats_v1(uuid, timestamptz, timestamptz, boolean)
IS 'Command Center P0 stats: queue/gamification + OCI pipeline counters (caller provides date range).';

REVOKE ALL ON FUNCTION public.get_command_center_p0_stats_v1(uuid, timestamptz, timestamptz, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_command_center_p0_stats_v1(uuid, timestamptz, timestamptz, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_command_center_p0_stats_v1(uuid, timestamptz, timestamptz, boolean) TO service_role;

COMMIT;


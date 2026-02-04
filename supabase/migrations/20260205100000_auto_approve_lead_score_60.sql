-- Auto-approve: set default lead_score to 60 (3 stars on 0-100 scale) for OCI value calculation.
-- Low-risk intents are still the only ones updated; behaviour otherwise unchanged.
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
      lead_score = GREATEST(COALESCE(c.lead_score, 0), 60),
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
IS 'Auto-approve stale click intents after N hours (low-risk only). Sets lead_score to at least 60 (3 stars). Never junks.';

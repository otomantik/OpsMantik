-- Traffic Source Breakdown v1: get_traffic_source_breakdown_v1
-- Returns session counts grouped by sessions.traffic_source for a site + date range.
-- Uses half-open range [from, to) and created_month for partition pruning.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_traffic_source_breakdown_v1(
  p_site_id uuid,
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_limit int DEFAULT 12
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_month_from date;
  v_month_to date;
  v_total bigint;
  v_rows jsonb;
  v_limit int;
BEGIN
  PERFORM validate_date_range(p_date_from, p_date_to);

  v_month_from := DATE_TRUNC('month', p_date_from)::date;
  v_month_to   := DATE_TRUNC('month', p_date_to)::date;
  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 12), 50));

  SELECT COUNT(*) INTO v_total
  FROM public.sessions s
  WHERE s.site_id = p_site_id
    AND s.created_at >= p_date_from
    AND s.created_at < p_date_to
    AND s.created_month BETWEEN v_month_from AND v_month_to;

  v_total := COALESCE(v_total, 0);

  WITH base AS (
    SELECT
      COALESCE(NULLIF(BTRIM(COALESCE(s.traffic_source, '')), ''), 'Unknown') AS src
    FROM public.sessions s
    WHERE s.site_id = p_site_id
      AND s.created_at >= p_date_from
      AND s.created_at < p_date_to
      AND s.created_month BETWEEN v_month_from AND v_month_to
  ),
  agg AS (
    SELECT src, COUNT(*)::bigint AS cnt
    FROM base
    GROUP BY src
    ORDER BY COUNT(*) DESC
    LIMIT v_limit
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'name', src,
      'count', cnt,
      'pct', CASE WHEN v_total > 0 THEN ROUND((cnt::numeric * 100.0 / v_total), 1) ELSE 0 END
    )
    ORDER BY cnt DESC
  )
  INTO v_rows
  FROM agg;

  v_rows := COALESCE(v_rows, '[]'::jsonb);

  RETURN jsonb_build_object(
    'total_sessions', v_total,
    'sources', v_rows
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_traffic_source_breakdown_v1(uuid, timestamptz, timestamptz, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_traffic_source_breakdown_v1(uuid, timestamptz, timestamptz, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_traffic_source_breakdown_v1(uuid, timestamptz, timestamptz, int) TO service_role;

COMMIT;


-- Backfill utm_term, utm_campaign, matchtype from first event URL when entry_page had no query string.
-- Scope: GCLID-bearing sessions with null utm_term/utm_campaign/matchtype; restrict to last 6 months by created_month.
-- Partition-safe: join events by (session_id, session_month = sessions.created_month). No full table scan.
-- Depends on public.get_url_param (20260130250700).

-- Bulk update: first event per session (earliest by created_at), parse url, fill only null columns.
WITH recent_sessions AS (
  SELECT s.id, s.created_month
  FROM public.sessions s
  WHERE s.gclid IS NOT NULL
    AND (s.utm_term IS NULL OR s.utm_campaign IS NULL OR s.matchtype IS NULL)
    AND s.created_month >= date_trunc('month', current_date - interval '6 months')::date
),
first_event AS (
  SELECT DISTINCT ON (e.session_id, e.session_month)
    e.session_id,
    e.session_month,
    e.url
  FROM public.events e
  INNER JOIN recent_sessions rs
    ON rs.id = e.session_id AND rs.created_month = e.session_month
  WHERE e.url IS NOT NULL AND e.url LIKE '%?%'
  ORDER BY e.session_id, e.session_month, e.created_at ASC
),
updated AS (
  UPDATE public.sessions s
  SET
    utm_term     = COALESCE(NULLIF(trim(s.utm_term), ''),     public.get_url_param(fe.url, 'utm_term')),
    utm_campaign = COALESCE(NULLIF(trim(s.utm_campaign), ''), public.get_url_param(fe.url, 'utm_campaign')),
    matchtype    = COALESCE(NULLIF(trim(s.matchtype), ''),    public.get_url_param(fe.url, 'matchtype')),
    utm_source   = COALESCE(NULLIF(trim(s.utm_source), ''),   public.get_url_param(fe.url, 'utm_source')),
    utm_medium   = COALESCE(NULLIF(trim(s.utm_medium), ''),   public.get_url_param(fe.url, 'utm_medium')),
    utm_content  = COALESCE(NULLIF(trim(s.utm_content), ''), public.get_url_param(fe.url, 'utm_content'))
  FROM first_event fe
  WHERE s.id = fe.session_id AND s.created_month = fe.session_month
  RETURNING s.id
)
SELECT count(*) AS sessions_updated_via_events FROM updated;

-- Single-session RPC for smoke/test: find earliest event for p_id, parse url, update session only where null.
CREATE OR REPLACE FUNCTION public.backfill_one_session_utm_from_events(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month date;
  v_url text;
  v_utm_term text;
  v_utm_campaign text;
  v_matchtype text;
  v_utm_source text;
  v_utm_medium text;
BEGIN
  SELECT s.created_month INTO v_month
  FROM public.sessions s
  WHERE s.id = p_id
  LIMIT 1;
  IF v_month IS NULL THEN
    RETURN;
  END IF;

  SELECT e.url INTO v_url
  FROM public.events e
  WHERE e.session_id = p_id AND e.session_month = v_month
    AND e.url IS NOT NULL AND e.url LIKE '%?%'
  ORDER BY e.created_at ASC
  LIMIT 1;
  IF v_url IS NULL THEN
    RETURN;
  END IF;

  -- Extract params using regex (same as entry_page RPC): value after param= until & or end
  v_utm_term    := substring(v_url from 'utm_term=([^&]+)');
  v_utm_campaign:= substring(v_url from 'utm_campaign=([^&]+)');
  v_matchtype   := substring(v_url from 'matchtype=([^&]+)');
  v_utm_source  := substring(v_url from 'utm_source=([^&]+)');
  v_utm_medium  := substring(v_url from 'utm_medium=([^&]+)');

  UPDATE public.sessions s
  SET
    utm_term     = COALESCE(s.utm_term,     v_utm_term),
    utm_campaign = COALESCE(s.utm_campaign, v_utm_campaign),
    matchtype    = COALESCE(s.matchtype,    v_matchtype),
    utm_source   = COALESCE(s.utm_source,   v_utm_source),
    utm_medium   = COALESCE(s.utm_medium,   v_utm_medium)
  WHERE s.id = p_id AND s.created_month = v_month;
END;
$$;

COMMENT ON FUNCTION public.backfill_one_session_utm_from_events(uuid)
IS 'Backfill session UTM from earliest event URL (partition-safe). Only fills null/empty. Used by smoke proof.';

GRANT EXECUTE ON FUNCTION public.backfill_one_session_utm_from_events(uuid) TO service_role;

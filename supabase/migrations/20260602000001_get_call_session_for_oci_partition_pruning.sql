-- =============================================================================
-- OCI Performance: get_call_session_for_oci partition pruning.
-- Uses calls.session_created_month for deterministic partition pruning.
-- Fallback: date_trunc('month', c.matched_at) when session_created_month is null.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_call_session_for_oci(p_call_id uuid, p_site_id uuid)
RETURNS TABLE(
  matched_session_id uuid,
  gclid text,
  wbraid text,
  gbraid text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  referrer_host text,
  consent_scopes text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.matched_session_id,
    s.gclid,
    s.wbraid,
    s.gbraid,
    s.utm_source,
    s.utm_medium,
    s.utm_campaign,
    s.utm_content,
    s.utm_term,
    s.referrer_host,
    s.consent_scopes
  FROM public.calls c
  LEFT JOIN public.sessions s ON s.id = c.matched_session_id
    AND s.site_id = c.site_id
    AND s.created_month = COALESCE(c.session_created_month, date_trunc('month', c.matched_at AT TIME ZONE 'utc')::date)
  WHERE c.id = p_call_id
    AND c.site_id = p_site_id
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.get_call_session_for_oci(uuid, uuid) IS
  'OCI perf: returns call + session in one query. Uses session_created_month for partition pruning.';

COMMIT;

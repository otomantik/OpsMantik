-- =============================================================================
-- OCI Performance: Single round-trip for call + session (primary-source, consent-check).
-- Replaces 2 sequential queries with 1 RPC.
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
  LEFT JOIN public.sessions s ON s.id = c.matched_session_id AND s.site_id = c.site_id
  WHERE c.id = p_call_id
    AND c.site_id = p_site_id
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.get_call_session_for_oci(uuid, uuid) IS
  'OCI perf: returns call + session in one query. Used by primary-source and consent-check.';

GRANT EXECUTE ON FUNCTION public.get_call_session_for_oci(uuid, uuid) TO service_role;

COMMIT;

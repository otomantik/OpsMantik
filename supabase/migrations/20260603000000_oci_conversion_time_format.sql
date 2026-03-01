-- =============================================================================
-- OCI: get_call_session_for_oci — conversion_time yyyyMMdd HHmmss
-- Original event time (calls.created_at); fallback queue.created_at.
-- Google Ads: timezone offset göndermiyoruz; hesap ayarı (Europe/Istanbul) kullanılır.
-- =============================================================================

BEGIN;

-- Cannot change RETURNS TABLE with CREATE OR REPLACE; must DROP first.
DROP FUNCTION IF EXISTS public.get_call_session_for_oci(uuid, uuid);

CREATE FUNCTION public.get_call_session_for_oci(p_call_id uuid, p_site_id uuid)
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
  consent_scopes text[],
  conversion_time_formatted text
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
    s.consent_scopes,
    to_char(
      COALESCE(c.created_at, oq.created_at) AT TIME ZONE COALESCE(st.timezone, 'Europe/Istanbul'),
      'YYYYMMDD HH24MISS'
    ) AS conversion_time_formatted
  FROM public.calls c
  LEFT JOIN public.sessions s ON s.id = c.matched_session_id
    AND s.site_id = c.site_id
    AND s.created_month = COALESCE(c.session_created_month, date_trunc('month', c.matched_at AT TIME ZONE 'utc')::date)
  LEFT JOIN public.sites st ON st.id = c.site_id
  LEFT JOIN public.offline_conversion_queue oq ON oq.call_id = c.id AND oq.site_id = c.site_id
  WHERE c.id = p_call_id
    AND c.site_id = p_site_id
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.get_call_session_for_oci(uuid, uuid) IS
  'OCI: call + session + conversion_time_formatted (yyyyMMdd HHmmss). Uses calls.created_at; fallback oq.created_at.';

GRANT EXECUTE ON FUNCTION public.get_call_session_for_oci(uuid, uuid) TO service_role;

COMMIT;

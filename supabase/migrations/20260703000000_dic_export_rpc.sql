-- DIC (Deep-Attribution) export: single-call row + redundant_identities report
-- get_dic_export_for_call: raw_phone, phone_source_type, country_iso, timestamps, user_agent, historical_gclid (90d)
-- get_redundant_identities: fingerprint -> distinct phone_number list (same fingerprint, multiple phones)

BEGIN;

-- Single conversion row for DIC / Enhanced Conversions pre-flight
CREATE OR REPLACE FUNCTION public.get_dic_export_for_call(p_call_id uuid, p_site_id uuid)
RETURNS TABLE(
  raw_phone_string text,
  phone_source_type text,
  detected_country_iso text,
  event_timestamp_utc_ms bigint,
  first_fingerprint_touch_utc_ms bigint,
  user_agent_raw text,
  historical_gclid_presence boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH c AS (
    SELECT
      c.phone_number,
      c.phone_source_type,
      c.user_agent,
      c.matched_fingerprint,
      c.site_id,
      c.confirmed_at,
      c.matched_at,
      c.session_created_month
    FROM public.calls c
    WHERE c.id = p_call_id AND c.site_id = p_site_id
    LIMIT 1
  ),
  site_country AS (
    SELECT s.default_country_iso
    FROM public.sites s
    INNER JOIN c ON c.site_id = s.id
    LIMIT 1
  ),
  first_touch AS (
    SELECT MIN(s2.created_at) AS first_at
    FROM public.sessions s2
    INNER JOIN c ON c.site_id = s2.site_id AND c.matched_fingerprint IS NOT NULL AND s2.fingerprint = c.matched_fingerprint
    WHERE s2.created_at >= (SELECT COALESCE(c.confirmed_at, c.matched_at) FROM c) - interval '90 days'
  ),
  gclid_90d AS (
    SELECT EXISTS (
      SELECT 1
      FROM public.sessions s2
      INNER JOIN c ON c.site_id = s2.site_id AND c.matched_fingerprint IS NOT NULL AND s2.fingerprint = c.matched_fingerprint
      WHERE s2.gclid IS NOT NULL
        AND s2.created_at >= (SELECT COALESCE(c.confirmed_at, c.matched_at) FROM c) - interval '90 days'
    ) AS has_gclid
  )
  SELECT
    c.phone_number AS raw_phone_string,
    c.phone_source_type,
    (SELECT default_country_iso FROM site_country) AS detected_country_iso,
    (EXTRACT(EPOCH FROM COALESCE(c.confirmed_at, c.matched_at)) * 1000)::bigint AS event_timestamp_utc_ms,
    (EXTRACT(EPOCH FROM (SELECT first_at FROM first_touch)) * 1000)::bigint AS first_fingerprint_touch_utc_ms,
    c.user_agent AS user_agent_raw,
    (SELECT has_gclid FROM gclid_90d) AS historical_gclid_presence
  FROM c;
$$;

COMMENT ON FUNCTION public.get_dic_export_for_call(uuid, uuid) IS
  'DIC: One row per call for Enhanced Conversions pre-flight. event_timestamp_utc_ms/first_fingerprint_touch_utc_ms in ms since epoch. historical_gclid_presence = any session with same fingerprint had gclid in last 90 days.';

GRANT EXECUTE ON FUNCTION public.get_dic_export_for_call(uuid, uuid) TO service_role;


-- Redundant identities: same fingerprint associated with multiple distinct phone numbers
CREATE OR REPLACE FUNCTION public.get_redundant_identities(p_site_id uuid, p_days int DEFAULT 90)
RETURNS TABLE(
  matched_fingerprint text,
  phone_numbers text[],
  call_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.matched_fingerprint,
    array_agg(DISTINCT c.phone_number ORDER BY c.phone_number) AS phone_numbers,
    count(*)::bigint AS call_count
  FROM public.calls c
  WHERE c.site_id = p_site_id
    AND c.matched_fingerprint IS NOT NULL
    AND c.matched_at >= (current_timestamp - (p_days || ' days')::interval)
  GROUP BY c.matched_fingerprint
  HAVING count(DISTINCT c.phone_number) > 1;
$$;

COMMENT ON FUNCTION public.get_redundant_identities(uuid, int) IS
  'DIC: Fingerprints with multiple distinct phone_number values in the last p_days. Used for conflict mapping and hash strategy (last vs all aliases).';

GRANT EXECUTE ON FUNCTION public.get_redundant_identities(uuid, int) TO service_role;

COMMIT;

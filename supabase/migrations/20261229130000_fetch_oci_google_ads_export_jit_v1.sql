-- PR-9H.8: Single-statement OCI Google Ads export read path — queue + calls + sessions
-- with JIT marketing consent gate (no dual-fetch race). Service_role only.

BEGIN;

CREATE OR REPLACE FUNCTION public.oci_export_apply_consent_gate_to_identifiers(
  p_uid jsonb,
  p_marketing_ok boolean
) RETURNS jsonb
  LANGUAGE plpgsql
  IMMUTABLE
  SET search_path TO public
  AS $fn$
DECLARE
  o jsonb;
  filtered jsonb;
BEGIN
  IF p_marketing_ok THEN
    RETURN p_uid;
  END IF;
  IF p_uid IS NULL THEN
    RETURN NULL;
  END IF;

  IF jsonb_typeof(p_uid) = 'array' THEN
    SELECT COALESCE(jsonb_agg(e ORDER BY ord), '[]'::jsonb)
    INTO filtered
    FROM jsonb_array_elements(p_uid) WITH ORDINALITY AS t(e, ord)
    WHERE jsonb_typeof(e) <> 'object'
       OR lower(btrim(COALESCE(e ->> 'type', ''))) NOT IN ('hashed_phone', 'hashed_email');
    RETURN filtered;
  END IF;

  IF jsonb_typeof(p_uid) <> 'object' THEN
    RETURN p_uid;
  END IF;

  o := p_uid #- '{hashed_phone}' #- '{hashedPhoneNumber}' #- '{hashed_email}' #- '{hashedEmail}';

  IF o ? 'userIdentifiers' AND jsonb_typeof(o -> 'userIdentifiers') = 'array' THEN
    SELECT COALESCE(jsonb_agg(e), '[]'::jsonb)
    INTO filtered
    FROM jsonb_array_elements(o -> 'userIdentifiers') AS e
    WHERE jsonb_typeof(e) <> 'object'
       OR lower(btrim(COALESCE(e ->> 'type', ''))) NOT IN ('hashed_phone', 'hashed_email');
    o := jsonb_set(o, '{userIdentifiers}', filtered, true);
  END IF;

  IF o ? 'user_identifiers' AND jsonb_typeof(o -> 'user_identifiers') = 'array' THEN
    SELECT COALESCE(jsonb_agg(e), '[]'::jsonb)
    INTO filtered
    FROM jsonb_array_elements(o -> 'user_identifiers') AS e
    WHERE jsonb_typeof(e) <> 'object'
       OR lower(btrim(COALESCE(e ->> 'type', ''))) NOT IN ('hashed_phone', 'hashed_email');
    o := jsonb_set(o, '{user_identifiers}', filtered, true);
  END IF;

  RETURN o;
END;
$fn$;

COMMENT ON FUNCTION public.oci_export_apply_consent_gate_to_identifiers(jsonb, boolean) IS
  'PR-9H.8: When p_marketing_ok is false, strip hashed phone/email from journal user_identifiers JSON (object + nested arrays).';

ALTER FUNCTION public.oci_export_apply_consent_gate_to_identifiers(jsonb, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.oci_export_apply_consent_gate_to_identifiers(jsonb, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.oci_export_apply_consent_gate_to_identifiers(jsonb, boolean) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.oci_export_apply_consent_gate_to_identifiers(jsonb, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.fetch_oci_google_ads_export_jit_v1(
  p_site_id uuid,
  p_provider_key text,
  p_limit integer,
  p_cursor_updated_at timestamptz DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL,
  p_canary_queue_ids uuid[] DEFAULT NULL
) RETURNS TABLE (
  id uuid,
  site_id uuid,
  status text,
  sale_id uuid,
  call_id uuid,
  session_id uuid,
  gclid text,
  wbraid text,
  gbraid text,
  user_identifiers jsonb,
  provider_path text,
  conversion_time timestamptz,
  occurred_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  value_cents bigint,
  optimization_stage text,
  optimization_value numeric,
  currency text,
  action text,
  external_id text,
  provider_key text,
  jit_call_status text,
  jit_call_oci_status text,
  jit_call_matched_session_id uuid,
  jit_call_created_at timestamptz,
  jit_call_confirmed_at timestamptz,
  jit_caller_phone_hash_sha256 text
)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO public
  AS $fn$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied',
      DETAIL = 'fetch_oci_google_ads_export_jit_v1 may only be called by service_role',
      ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT
    q.id,
    q.site_id,
    q.status,
    q.sale_id,
    q.call_id,
    q.session_id,
    q.gclid,
    q.wbraid,
    q.gbraid,
    public.oci_export_apply_consent_gate_to_identifiers(
      q.user_identifiers,
      (s.id IS NOT NULL AND s.consent_scopes IS NOT NULL AND 'marketing' = ANY (s.consent_scopes))
    ) AS user_identifiers,
    q.provider_path,
    q.conversion_time,
    q.occurred_at,
    q.created_at,
    q.updated_at,
    q.value_cents,
    q.optimization_stage,
    q.optimization_value,
    q.currency,
    q.action,
    q.external_id,
    q.provider_key,
    c.status AS jit_call_status,
    c.oci_status AS jit_call_oci_status,
    c.matched_session_id AS jit_call_matched_session_id,
    c.created_at AS jit_call_created_at,
    c.confirmed_at AS jit_call_confirmed_at,
    CASE
      WHEN s.id IS NOT NULL
        AND s.consent_scopes IS NOT NULL
        AND 'marketing' = ANY (s.consent_scopes)
      THEN NULLIF(btrim(c.caller_phone_hash_sha256), '')
      ELSE NULL::text
    END AS jit_caller_phone_hash_sha256
  FROM public.offline_conversion_queue AS q
  LEFT JOIN public.calls AS c
    ON c.id = q.call_id
   AND c.site_id = q.site_id
  LEFT JOIN public.sessions AS s
    ON s.id = c.matched_session_id
   AND s.site_id = q.site_id
  WHERE q.site_id = p_site_id
    AND q.provider_key = p_provider_key
    AND q.status = ANY (ARRAY['QUEUED'::text, 'RETRY'::text])
    AND (
      p_canary_queue_ids IS NULL
      OR cardinality(p_canary_queue_ids) = 0
      OR q.id = ANY (p_canary_queue_ids)
    )
    AND (
      p_cursor_updated_at IS NULL
      OR p_cursor_id IS NULL
      OR (q.updated_at > p_cursor_updated_at)
      OR (q.updated_at = p_cursor_updated_at AND q.id > p_cursor_id)
    )
  ORDER BY q.updated_at ASC, q.id ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 1), 1), 1000);
END;
$fn$;

COMMENT ON FUNCTION public.fetch_oci_google_ads_export_jit_v1(uuid, text, integer, timestamptz, uuid, uuid[]) IS
  'PR-9H.8: Atomic export slice — queue joined to calls + sessions; marketing consent gates caller_phone_hash_sha256 and strips EC identifiers in user_identifiers when absent.';

ALTER FUNCTION public.fetch_oci_google_ads_export_jit_v1(uuid, text, integer, timestamptz, uuid, uuid[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fetch_oci_google_ads_export_jit_v1(uuid, text, integer, timestamptz, uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fetch_oci_google_ads_export_jit_v1(uuid, text, integer, timestamptz, uuid, uuid[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fetch_oci_google_ads_export_jit_v1(uuid, text, integer, timestamptz, uuid, uuid[]) TO service_role;

COMMIT;

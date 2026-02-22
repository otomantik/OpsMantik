-- GDPR: Anonymize consent-less sessions/events older than retention window.
-- Run via cron. Does NOT delete; sets PII columns to NULL.
BEGIN;
CREATE OR REPLACE FUNCTION public.anonymize_consent_less_data(p_days int DEFAULT 90)
RETURNS TABLE(sessions_affected bigint, events_affected bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cutoff timestamptz;
  v_sessions bigint := 0;
  v_events bigint := 0;
BEGIN
  v_cutoff := now() - (COALESCE(NULLIF(p_days, 0), 90) || ' days')::interval;

  WITH upds AS (
    UPDATE public.sessions SET
      ip_address = NULL, entry_page = NULL, exit_page = NULL,
      gclid = NULL, wbraid = NULL, gbraid = NULL, fingerprint = NULL,
      ai_summary = NULL, ai_tags = NULL, user_journey_path = NULL
    WHERE consent_at IS NULL AND (consent_scopes IS NULL OR consent_scopes = '{}')
      AND created_at < v_cutoff
    RETURNING 1
  )
  SELECT count(*)::bigint INTO v_sessions FROM upds;

  WITH upds AS (
    UPDATE public.events SET metadata = '{}'
    WHERE consent_at IS NULL AND (consent_scopes IS NULL OR consent_scopes = '{}')
      AND created_at < v_cutoff
    RETURNING 1
  )
  SELECT count(*)::bigint INTO v_events FROM upds;

  RETURN QUERY SELECT v_sessions, v_events;
END; $$;
GRANT EXECUTE ON FUNCTION public.anonymize_consent_less_data(int) TO service_role;
COMMIT;

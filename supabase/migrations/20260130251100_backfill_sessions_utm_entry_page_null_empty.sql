-- Backfill: single-session RPC — extract UTM from entry_page and update session ONLY where columns are NULL.
-- Partition-safe: UPDATE against parent public.sessions routes to partitions in PostgreSQL.
-- Used by smoke test backfill-entry-page-proof.mjs.

-- Drop any prior version (e.g. RETURNS integer or RETURNS TABLE) so we can replace with RETURNS void.
DROP FUNCTION IF EXISTS public.backfill_one_session_utm_from_entry_page(uuid);

CREATE OR REPLACE FUNCTION public.backfill_one_session_utm_from_entry_page(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry_page text;
  v_utm_term text;
  v_utm_campaign text;
  v_matchtype text;
  v_utm_source text;
  v_utm_medium text;
BEGIN
  -- 1. Get the entry_page for the session
  SELECT entry_page INTO v_entry_page
  FROM public.sessions
  WHERE id = p_id;

  -- If no entry page, exit
  IF v_entry_page IS NULL THEN
    RETURN;
  END IF;

  -- 2. Extract params using regex (simple extraction)
  -- captures value after param= until & or end of string
  v_utm_term := substring(v_entry_page from 'utm_term=([^&]+)');
  v_utm_campaign := substring(v_entry_page from 'utm_campaign=([^&]+)');
  v_matchtype := substring(v_entry_page from 'matchtype=([^&]+)');
  v_utm_source := substring(v_entry_page from 'utm_source=([^&]+)');
  v_utm_medium := substring(v_entry_page from 'utm_medium=([^&]+)');

  -- 3. Update the session ONLY where fields are currently NULL
  UPDATE public.sessions
  SET
    utm_term = COALESCE(utm_term, v_utm_term),
    utm_campaign = COALESCE(utm_campaign, v_utm_campaign),
    matchtype = COALESCE(matchtype, v_matchtype),
    utm_source = COALESCE(utm_source, v_utm_source),
    utm_medium = COALESCE(utm_medium, v_utm_medium)
  WHERE id = p_id;

END;
$$;

COMMENT ON FUNCTION public.backfill_one_session_utm_from_entry_page(uuid)
IS 'Extract UTM from session entry_page and update session columns ONLY where currently NULL. Used by smoke proof.';

GRANT EXECUTE ON FUNCTION public.backfill_one_session_utm_from_entry_page(uuid) TO service_role;

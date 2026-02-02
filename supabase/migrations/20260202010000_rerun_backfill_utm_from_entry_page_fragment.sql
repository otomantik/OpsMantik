-- =============================================================================
-- RERUN Backfill: Extract UTM params from entry_page fragment/hash
--
-- Why: Some Google Ads redirect flows put utm_* and matchtype after "#" (fragment),
-- e.g. https://domain.com/?gclid=xxx#utm_term=keyword&matchtype=p
--
-- The original backfill migration may have run before some affected rows existed.
-- This rerun safely fills ONLY null/empty fields for recent months.
-- =============================================================================

UPDATE public.sessions s
SET
  utm_term = COALESCE(
    NULLIF(BTRIM(s.utm_term), ''),
    (SELECT (regexp_matches(s.entry_page, '[?&#]utm_term=([^&]+)', 'i'))[1])
  ),
  matchtype = COALESCE(
    NULLIF(BTRIM(s.matchtype), ''),
    (SELECT (regexp_matches(s.entry_page, '[?&#]matchtype=([^&]+)', 'i'))[1])
  ),
  utm_source = COALESCE(
    NULLIF(BTRIM(s.utm_source), ''),
    (SELECT (regexp_matches(s.entry_page, '[?&#]utm_source=([^&]+)', 'i'))[1])
  ),
  utm_medium = COALESCE(
    NULLIF(BTRIM(s.utm_medium), ''),
    (SELECT (regexp_matches(s.entry_page, '[?&#]utm_medium=([^&]+)', 'i'))[1])
  ),
  utm_campaign = COALESCE(
    NULLIF(BTRIM(s.utm_campaign), ''),
    (SELECT (regexp_matches(s.entry_page, '[?&#]utm_campaign=([^&]+)', 'i'))[1])
  ),
  utm_content = COALESCE(
    NULLIF(BTRIM(s.utm_content), ''),
    (SELECT (regexp_matches(s.entry_page, '[?&#]utm_content=([^&]+)', 'i'))[1])
  )
WHERE
  -- limit scope for safety/perf
  s.created_month >= date_trunc('month', current_date - interval '6 months')::date
  -- only sessions that actually contain UTM-like params somewhere in entry_page
  AND s.entry_page ~* '(utm_source=|utm_medium=|utm_campaign=|utm_term=|utm_content=|matchtype=)'
  -- only fill when something is missing
  AND (
    NULLIF(BTRIM(s.utm_term), '') IS NULL
    OR NULLIF(BTRIM(s.matchtype), '') IS NULL
    OR NULLIF(BTRIM(s.utm_source), '') IS NULL
    OR NULLIF(BTRIM(s.utm_medium), '') IS NULL
    OR NULLIF(BTRIM(s.utm_campaign), '') IS NULL
    OR NULLIF(BTRIM(s.utm_content), '') IS NULL
  );

DO $$
DECLARE
  v_updated integer;
BEGIN
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE 'Rerun backfill: updated % sessions (utm_* / matchtype from entry_page fragment)', v_updated;
END $$;


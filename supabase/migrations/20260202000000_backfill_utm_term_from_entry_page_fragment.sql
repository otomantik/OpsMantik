-- =============================================================================
-- Backfill: Extract utm_term and matchtype from entry_page (including fragment)
-- 
-- Problem: Some Google Ads redirect URLs have UTM params after fragment (#)
-- Example: https://domain.com/?gclid=xxx#4?utm_term=keyword&matchtype=p
-- 
-- Solution: Use regex to extract utm_term and matchtype from entry_page
-- =============================================================================

-- Backfill sessions where entry_page has utm_term but DB column is NULL
UPDATE public.sessions s
SET 
  utm_term = COALESCE(
    s.utm_term,
    (SELECT (regexp_matches(s.entry_page, '[?&#]utm_term=([^&]+)', 'i'))[1])
  ),
  matchtype = COALESCE(
    s.matchtype,
    (SELECT (regexp_matches(s.entry_page, '[?&#]matchtype=([^&]+)', 'i'))[1])
  ),
  utm_source = COALESCE(
    s.utm_source,
    (SELECT (regexp_matches(s.entry_page, '[?&#]utm_source=([^&]+)', 'i'))[1])
  ),
  utm_medium = COALESCE(
    s.utm_medium,
    (SELECT (regexp_matches(s.entry_page, '[?&#]utm_medium=([^&]+)', 'i'))[1])
  ),
  utm_campaign = COALESCE(
    s.utm_campaign,
    (SELECT (regexp_matches(s.entry_page, '[?&#]utm_campaign=([^&]+)', 'i'))[1])
  ),
  utm_content = COALESCE(
    s.utm_content,
    (SELECT (regexp_matches(s.entry_page, '[?&#]utm_content=([^&]+)', 'i'))[1])
  )
WHERE s.entry_page LIKE '%utm_%'
  AND (
    s.utm_term IS NULL 
    OR s.matchtype IS NULL 
    OR s.utm_source IS NULL 
    OR s.utm_medium IS NULL 
    OR s.utm_campaign IS NULL
  );

-- Log results
DO $$
DECLARE
  v_updated INTEGER;
BEGIN
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE 'Backfilled UTM params for % sessions from entry_page', v_updated;
END $$;

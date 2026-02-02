-- =============================================================================
-- OpsMantik - Cleanup Quick Audit Pack (READ ONLY)
-- Purpose: Catch P0 correctness regressions early (partition drift, orphans, ads gating, RPC health)
-- Run in: Supabase SQL Editor (production or staging)
-- Safety: READ ONLY (SELECT only)
-- =============================================================================

-- -------------------------------
-- A) Partition / month-key drift
-- Expected: 0
-- -------------------------------
SELECT COUNT(*) AS bad_sessions_partition_key
FROM public.sessions s
WHERE s.created_month <> date_trunc('month', (s.created_at AT TIME ZONE 'utc'))::date;

-- Expected: 0
SELECT COUNT(*) AS bad_events_partition_key
FROM public.events e
JOIN public.sessions s ON s.id = e.session_id
WHERE e.session_month <> s.created_month;

-- -------------------------------
-- B) Orphans / referential integrity (calls ↔ sessions, events ↔ sessions)
-- Expected: 0
-- -------------------------------
SELECT COUNT(*) AS calls_with_missing_session
FROM public.calls c
LEFT JOIN public.sessions s
  ON s.id = c.matched_session_id
 AND s.site_id = c.site_id
WHERE c.matched_session_id IS NOT NULL
  AND s.id IS NULL;

SELECT COUNT(*) AS events_with_missing_session
FROM public.events e
LEFT JOIN public.sessions s ON s.id = e.session_id
WHERE s.id IS NULL;

-- -------------------------------
-- C) Ads-only gating sanity (is_ads_session)
-- If ads_rate is ~0% for a paid-search site, tracking template/click-id capture is broken.
-- -------------------------------
SELECT
  COUNT(*) FILTER (WHERE public.is_ads_session(s)) AS ads_sessions_30d,
  COUNT(*) AS total_sessions_30d,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE public.is_ads_session(s)) / NULLIF(COUNT(*), 0),
    1
  ) AS ads_rate_pct_30d
FROM public.sessions s
WHERE s.created_at >= now() - interval '30 days';

-- -------------------------------
-- D) Keyword / UTM capture sanity for GCLID sessions
-- Notes:
-- - utm_term is only capturable if the landing URL has utm_term (tracking template).
-- - If gclid exists but utm_term coverage is near 0%, tracking template is missing.
-- -------------------------------
SELECT
  COUNT(*) AS gclid_sessions_30d,
  COUNT(*) FILTER (WHERE NULLIF(BTRIM(s.utm_term), '') IS NOT NULL) AS with_utm_term_30d,
  COUNT(*) FILTER (WHERE NULLIF(BTRIM(s.matchtype), '') IS NOT NULL) AS with_matchtype_30d,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE NULLIF(BTRIM(s.utm_term), '') IS NOT NULL) / NULLIF(COUNT(*), 0),
    1
  ) AS utm_term_coverage_pct_30d
FROM public.sessions s
WHERE s.gclid IS NOT NULL
  AND s.created_at >= now() - interval '30 days';

-- -------------------------------
-- E) OCI pipeline health (last 30 days)
-- Expected:
-- - 'failed' should be near 0; investigate spikes
-- -------------------------------
SELECT
  COALESCE(c.oci_status, '(null)') AS oci_status,
  COUNT(*) AS calls_30d
FROM public.calls c
WHERE c.created_at >= now() - interval '30 days'
GROUP BY 1
ORDER BY calls_30d DESC;

-- -------------------------------
-- F) RPC health checks (manual parameters)
-- Fill in a site UUID you have access to.
-- Expected:
-- - returns jsonb[] without error
-- -------------------------------
-- SELECT public.get_recent_intents_v2(
--   '<SITE_UUID_HERE>'::uuid,
--   now() - interval '2 hours',
--   now(),
--   10,
--   true
-- );

-- SELECT public.get_command_center_p0_stats_v2(
--   '<SITE_UUID_HERE>'::uuid,
--   now() - interval '24 hours',
--   now(),
--   true
-- );

-- =============================================================================
-- End
-- =============================================================================


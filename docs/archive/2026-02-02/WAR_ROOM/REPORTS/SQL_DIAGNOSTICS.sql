-- SQL Diagnostics for Call Match Integrity
-- Run these queries in Supabase SQL Editor to establish baseline
-- Date: 2026-01-27

-- ============================================
-- Query 1: Impossible Matches
-- ============================================
-- Definition: Calls where matched_at is earlier than session's first event by > 2 minutes

WITH session_first_events AS (
  SELECT 
    s.id as session_id,
    s.created_at as session_created_at,
    s.created_month,
    COALESCE(
      (SELECT MIN(e.created_at) 
       FROM events e 
       WHERE e.session_id = s.id 
         AND e.session_month = s.created_month),
      s.created_at
    ) as first_event_at
  FROM sessions s
),
impossible_matches AS (
  SELECT 
    c.id as call_id,
    c.phone_number,
    c.matched_session_id,
    c.matched_at,
    c.created_at as call_created_at,
    sfe.session_created_at,
    sfe.first_event_at,
    EXTRACT(EPOCH FROM (sfe.first_event_at - c.matched_at)) / 60 as minutes_before_session
  FROM calls c
  INNER JOIN session_first_events sfe ON c.matched_session_id = sfe.session_id
  WHERE c.matched_at IS NOT NULL
    AND c.matched_session_id IS NOT NULL
    AND sfe.first_event_at > c.matched_at + INTERVAL '2 minutes'
)
SELECT 
  COUNT(*) as impossible_match_count,
  COUNT(DISTINCT matched_session_id) as affected_sessions,
  ROUND(AVG(minutes_before_session)::numeric, 2) as avg_minutes_before,
  ROUND(MIN(minutes_before_session)::numeric, 2) as min_minutes_before,
  ROUND(MAX(minutes_before_session)::numeric, 2) as max_minutes_before
FROM impossible_matches;

-- Detailed list (top 10)
WITH session_first_events AS (
  SELECT 
    s.id as session_id,
    s.created_at as session_created_at,
    s.created_month,
    COALESCE(
      (SELECT MIN(e.created_at) 
       FROM events e 
       WHERE e.session_id = s.id 
         AND e.session_month = s.created_month),
      s.created_at
    ) as first_event_at
  FROM sessions s
),
impossible_matches AS (
  SELECT 
    c.id as call_id,
    c.phone_number,
    c.matched_session_id,
    c.matched_at,
    c.created_at as call_created_at,
    sfe.session_created_at,
    sfe.first_event_at,
    EXTRACT(EPOCH FROM (sfe.first_event_at - c.matched_at)) / 60 as minutes_before_session
  FROM calls c
  INNER JOIN session_first_events sfe ON c.matched_session_id = sfe.session_id
  WHERE c.matched_at IS NOT NULL
    AND c.matched_session_id IS NOT NULL
    AND sfe.first_event_at > c.matched_at + INTERVAL '2 minutes'
)
SELECT 
  call_id,
  phone_number,
  matched_session_id,
  matched_at,
  first_event_at,
  ROUND(minutes_before_session::numeric, 2) as minutes_before
FROM impossible_matches
ORDER BY minutes_before_session DESC
LIMIT 10;

-- ============================================
-- Query 2: Match Method Distribution
-- ============================================
-- Count calls matched by session_id vs fingerprint-only

SELECT 
  CASE 
    WHEN matched_session_id IS NOT NULL THEN 'by_session_id'
    WHEN matched_fingerprint IS NOT NULL AND matched_session_id IS NULL THEN 'by_fingerprint_only'
    ELSE 'no_match'
  END as match_method,
  COUNT(*) as call_count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage
FROM calls
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY match_method
ORDER BY call_count DESC;

-- ============================================
-- Query 3: Fingerprint Leakage Detection
-- ============================================
-- Find calls that match a session by fingerprint but matched_session_id is NULL or different

WITH session_fingerprints AS (
  SELECT DISTINCT
    s.id as session_id,
    s.fingerprint,
    s.site_id,
    s.created_at as session_created_at
  FROM sessions s
  WHERE s.fingerprint IS NOT NULL
),
fingerprint_matches AS (
  SELECT 
    c.id as call_id,
    c.phone_number,
    c.matched_session_id,
    c.matched_fingerprint,
    c.created_at as call_created_at,
    sf.session_id as actual_session_id,
    sf.session_created_at
  FROM calls c
  INNER JOIN session_fingerprints sf 
    ON c.matched_fingerprint = sf.fingerprint
    AND c.site_id = sf.site_id
  WHERE c.matched_fingerprint IS NOT NULL
    AND (
      c.matched_session_id IS NULL 
      OR c.matched_session_id != sf.session_id
    )
    AND c.created_at >= sf.session_created_at - INTERVAL '30 minutes'
    AND c.created_at <= sf.session_created_at + INTERVAL '30 minutes'
)
SELECT 
  COUNT(*) as fingerprint_leakage_count,
  COUNT(DISTINCT call_id) as affected_calls,
  COUNT(DISTINCT actual_session_id) as affected_sessions
FROM fingerprint_matches;

-- Top 10 leakage examples
WITH session_fingerprints AS (
  SELECT DISTINCT
    s.id as session_id,
    s.fingerprint,
    s.site_id,
    s.created_at as session_created_at
  FROM sessions s
  WHERE s.fingerprint IS NOT NULL
),
fingerprint_matches AS (
  SELECT 
    c.id as call_id,
    c.phone_number,
    c.matched_session_id,
    c.matched_fingerprint,
    c.created_at as call_created_at,
    sf.session_id as actual_session_id,
    sf.session_created_at
  FROM calls c
  INNER JOIN session_fingerprints sf 
    ON c.matched_fingerprint = sf.fingerprint
    AND c.site_id = sf.site_id
  WHERE c.matched_fingerprint IS NOT NULL
    AND (
      c.matched_session_id IS NULL 
      OR c.matched_session_id != sf.session_id
    )
    AND c.created_at >= sf.session_created_at - INTERVAL '30 minutes'
    AND c.created_at <= sf.session_created_at + INTERVAL '30 minutes'
)
SELECT 
  call_id,
  phone_number,
  matched_session_id as call_matched_to,
  actual_session_id as should_match_to,
  matched_fingerprint,
  call_created_at,
  session_created_at
FROM fingerprint_matches
ORDER BY call_created_at DESC
LIMIT 10;

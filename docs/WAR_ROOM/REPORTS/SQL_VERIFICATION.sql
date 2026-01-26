-- SQL Verification Queries for Call Match Integrity v1.1
-- Run these AFTER implementing fixes to verify improvements
-- Date: 2026-01-27

-- ============================================
-- Verification 1: Impossible Matches Should Be 0 (or Only Suspicious)
-- ============================================
-- After fix: All impossible matches should be marked as 'suspicious'

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
    c.status,
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
  COUNT(CASE WHEN status = 'suspicious' THEN 1 END) as suspicious_count,
  COUNT(CASE WHEN status != 'suspicious' THEN 1 END) as not_suspicious_count
FROM impossible_matches;

-- Expected: suspicious_count = impossible_match_count (all flagged)

-- ============================================
-- Verification 2: Fingerprint Leakage Should Be Reduced
-- ============================================
-- After UI fix: Session cards should only show calls with matched_session_id

WITH session_fingerprints AS (
  SELECT DISTINCT
    s.id as session_id,
    s.fingerprint,
    s.site_id
  FROM sessions s
  WHERE s.fingerprint IS NOT NULL
),
fingerprint_matches AS (
  SELECT 
    c.id as call_id,
    c.matched_session_id,
    c.matched_fingerprint,
    sf.session_id as actual_session_id
  FROM calls c
  INNER JOIN session_fingerprints sf 
    ON c.matched_fingerprint = sf.fingerprint
    AND c.site_id = sf.site_id
  WHERE c.matched_fingerprint IS NOT NULL
    AND (
      c.matched_session_id IS NULL 
      OR c.matched_session_id != sf.session_id
    )
)
SELECT 
  COUNT(*) as fingerprint_leakage_count,
  COUNT(CASE WHEN matched_session_id IS NULL THEN 1 END) as null_matched_session,
  COUNT(CASE WHEN matched_session_id IS NOT NULL AND matched_session_id != actual_session_id THEN 1 END) as wrong_session
FROM fingerprint_matches;

-- Expected: Count should be stable (these are data-level, not UI)
-- UI fix prevents these from showing on wrong session cards

-- ============================================
-- Verification 3: Match Method Distribution Should Improve
-- ============================================
-- After backend validation: More calls should have matched_session_id

SELECT 
  CASE 
    WHEN matched_session_id IS NOT NULL THEN 'by_session_id'
    WHEN matched_fingerprint IS NOT NULL AND matched_session_id IS NULL THEN 'by_fingerprint_only'
    ELSE 'no_match'
  END as match_method,
  COUNT(*) as call_count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage,
  COUNT(CASE WHEN status = 'suspicious' THEN 1 END) as suspicious_in_method
FROM calls
WHERE created_at >= NOW() - INTERVAL '7 days'  -- Last 7 days for recent data
GROUP BY match_method
ORDER BY call_count DESC;

-- Expected: 
-- - by_session_id should be highest percentage
-- - suspicious_in_method should be 0 for by_session_id (validation prevents invalid matches)
-- - by_fingerprint_only should be low (calls that couldn't find session)

-- ============================================
-- Verification 4: Suspicious Status Distribution
-- ============================================
-- Check that suspicious matches are properly flagged

SELECT 
  status,
  COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage
FROM calls
WHERE created_at >= NOW() - INTERVAL '7 days'
GROUP BY status
ORDER BY count DESC;

-- Expected: 
-- - 'suspicious' status exists and is used
-- - 'intent' is most common for matched calls
-- - null/legacy statuses should decrease over time

-- ============================================
-- Verification 5: Match Validity Check
-- ============================================
-- All calls with matched_session_id should have valid sessions

SELECT 
  COUNT(*) as total_matched_calls,
  COUNT(CASE WHEN s.id IS NOT NULL THEN 1 END) as valid_session_count,
  COUNT(CASE WHEN s.id IS NULL THEN 1 END) as invalid_session_count
FROM calls c
LEFT JOIN sessions s ON c.matched_session_id = s.id
WHERE c.matched_session_id IS NOT NULL
  AND c.created_at >= NOW() - INTERVAL '7 days';

-- Expected: invalid_session_count = 0 (backend validation prevents this)

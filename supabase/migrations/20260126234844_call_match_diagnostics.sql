-- Migration: Call Match Integrity Diagnostics
-- Date: 2026-01-27
-- Purpose: Diagnostic queries for call match integrity analysis
-- Note: These are SELECT queries, no schema changes

-- ============================================
-- Query 1: Impossible Matches Summary
-- ============================================
-- Definition: Calls where matched_at is earlier than session's first event by > 2 minutes

DO $$
DECLARE
  result_count INTEGER;
  result_sessions INTEGER;
  result_avg NUMERIC;
  result_min NUMERIC;
  result_max NUMERIC;
BEGIN
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
      c.matched_session_id,
      sfe.first_event_at,
      EXTRACT(EPOCH FROM (sfe.first_event_at - c.matched_at)) / 60 as minutes_before_session
    FROM calls c
    INNER JOIN session_first_events sfe ON c.matched_session_id = sfe.session_id
    WHERE c.matched_at IS NOT NULL
      AND c.matched_session_id IS NOT NULL
      AND sfe.first_event_at > c.matched_at + INTERVAL '2 minutes'
  )
  SELECT 
    COUNT(*)::INTEGER,
    COUNT(DISTINCT matched_session_id)::INTEGER,
    ROUND(AVG(minutes_before_session)::numeric, 2),
    ROUND(MIN(minutes_before_session)::numeric, 2),
    ROUND(MAX(minutes_before_session)::numeric, 2)
  INTO result_count, result_sessions, result_avg, result_min, result_max
  FROM impossible_matches;
  
  RAISE NOTICE 'Query 1 Results:';
  RAISE NOTICE '  Impossible Match Count: %', result_count;
  RAISE NOTICE '  Affected Sessions: %', result_sessions;
  RAISE NOTICE '  Avg Minutes Before: %', result_avg;
  RAISE NOTICE '  Min Minutes Before: %', result_min;
  RAISE NOTICE '  Max Minutes Before: %', result_max;
END $$;

-- ============================================
-- Query 2: Match Method Distribution
-- ============================================

DO $$
DECLARE
  by_session_id_count INTEGER;
  by_fingerprint_count INTEGER;
  no_match_count INTEGER;
  total_count INTEGER;
BEGIN
  SELECT 
    COUNT(*) FILTER (WHERE matched_session_id IS NOT NULL)::INTEGER,
    COUNT(*) FILTER (WHERE matched_fingerprint IS NOT NULL AND matched_session_id IS NULL)::INTEGER,
    COUNT(*) FILTER (WHERE matched_session_id IS NULL AND matched_fingerprint IS NULL)::INTEGER,
    COUNT(*)::INTEGER
  INTO by_session_id_count, by_fingerprint_count, no_match_count, total_count
  FROM calls
  WHERE created_at >= NOW() - INTERVAL '30 days';
  
  RAISE NOTICE 'Query 2 Results:';
  RAISE NOTICE '  By Session ID: % (%%%)', by_session_id_count, ROUND(by_session_id_count * 100.0 / NULLIF(total_count, 0), 2);
  RAISE NOTICE '  By Fingerprint Only: % (%%%)', by_fingerprint_count, ROUND(by_fingerprint_count * 100.0 / NULLIF(total_count, 0), 2);
  RAISE NOTICE '  No Match: % (%%%)', no_match_count, ROUND(no_match_count * 100.0 / NULLIF(total_count, 0), 2);
END $$;

-- ============================================
-- Query 3: Fingerprint Leakage Detection
-- ============================================

DO $$
DECLARE
  leakage_count INTEGER;
  affected_calls INTEGER;
  affected_sessions INTEGER;
BEGIN
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
      c.matched_session_id,
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
      AND c.created_at >= sf.session_created_at - INTERVAL '30 minutes'
      AND c.created_at <= sf.session_created_at + INTERVAL '30 minutes'
  )
  SELECT 
    COUNT(*)::INTEGER,
    COUNT(DISTINCT call_id)::INTEGER,
    COUNT(DISTINCT actual_session_id)::INTEGER
  INTO leakage_count, affected_calls, affected_sessions
  FROM fingerprint_matches;
  
  RAISE NOTICE 'Query 3 Results:';
  RAISE NOTICE '  Fingerprint Leakage Count: %', leakage_count;
  RAISE NOTICE '  Affected Calls: %', affected_calls;
  RAISE NOTICE '  Affected Sessions: %', affected_sessions;
END $$;

-- Note: Detailed results are available in docs/WAR_ROOM/REPORTS/SQL_DIAGNOSTICS.sql
-- Run those queries in Supabase SQL Editor for full details

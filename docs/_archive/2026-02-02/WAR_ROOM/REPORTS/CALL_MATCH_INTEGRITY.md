# Call Match Integrity Report

**Date**: 2026-01-27  
**Purpose**: Identify data integrity issues in call-to-session matching  
**Status**: Analysis Complete

---

## Executive Summary

This report analyzes call matching integrity by examining:
1. **Impossible matches**: Calls matched to sessions that didn't exist yet
2. **Fingerprint leakage**: Session cards showing calls by fingerprint instead of matched_session_id
3. **Match method distribution**: How many calls are matched by session_id vs fingerprint-only

---

## A. Database Reality Checks

### SQL Query 1: Impossible Matches

**Definition**: Calls where `matched_at` is earlier than the session's first event by more than 2 minutes (accounting for clock skew).

```sql
-- Find calls where matched_at < session.created_at (or first_event_at) by > 2 minutes
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
  AVG(minutes_before_session) as avg_minutes_before,
  MIN(minutes_before_session) as min_minutes_before,
  MAX(minutes_before_session) as max_minutes_before
FROM impossible_matches;

-- Detailed list (limit 100)
SELECT 
  call_id,
  phone_number,
  matched_session_id,
  matched_at,
  first_event_at,
  ROUND(minutes_before_session::numeric, 2) as minutes_before
FROM impossible_matches
ORDER BY minutes_before_session DESC
LIMIT 100;
```

**Expected Findings**:
- Should return 0 rows if matching logic is correct
- Any rows indicate calls matched to sessions that didn't exist yet (data integrity issue)

---

### SQL Query 2: Match Method Distribution

**Count calls matched by session_id vs fingerprint-only**

```sql
-- Count match methods
SELECT 
  CASE 
    WHEN matched_session_id IS NOT NULL THEN 'by_session_id'
    WHEN matched_fingerprint IS NOT NULL AND matched_session_id IS NULL THEN 'by_fingerprint_only'
    ELSE 'no_match'
  END as match_method,
  COUNT(*) as call_count,
  COUNT(*) * 100.0 / SUM(COUNT(*)) OVER () as percentage
FROM calls
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY match_method
ORDER BY call_count DESC;
```

**Expected Findings**:
- Most calls should be `by_session_id` (proper match)
- `by_fingerprint_only` indicates calls that couldn't find a session but have fingerprint
- `no_match` indicates calls with no matching data

---

### SQL Query 3: Fingerprint Leakage Detection

**Find sessions showing calls matched by fingerprint instead of matched_session_id**

```sql
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
```

**Expected Findings**:
- Should identify calls that could be matched to sessions but aren't
- Indicates potential matching logic gaps

---

## B. Code Analysis: Fingerprint Leakage in UI

### Issue Location: `components/dashboard/session-group.tsx`

**Lines 89-119**: Session card fetches calls by fingerprint instead of checking matched_session_id

```typescript
// Current implementation (PROBLEMATIC):
supabase
  .from('calls')
  .select('*, sites!inner(user_id)')
  .eq('matched_fingerprint', currentFingerprint)  // ❌ Uses fingerprint
  .order('created_at', { ascending: false })
  .order('id', { ascending: false })
  .limit(1)
```

**Problem**: 
- Session cards show "MATCHED" badge when ANY call has the same fingerprint
- Should ONLY show when `calls.matched_session_id === session.id`
- This creates "fingerprint leakage" where calls from other sessions appear

**Evidence**:
- Line 368-373: Shows "MATCHED" badge if `matchedCall` exists
- Line 708-717: Displays matched call info in expanded view
- No check that `matchedCall.matched_session_id === sessionId`

---

## C. Match Validity Rules

### Current Behavior (from `app/api/call-event/route.ts`)

**Lines 119-131**: Matching logic
```typescript
const { data: recentEvents, error: eventsError } = await adminClient
  .from('events')
  .select('session_id, session_month, metadata, created_at')
  .eq('metadata->>fingerprint', fingerprint)
  .in('session_month', recentMonths)
  .gte('created_at', thirtyMinutesAgo)
  .order('created_at', { ascending: false })
  .order('id', { ascending: false })
  .limit(1);
```

**Issues**:
1. Matches by fingerprint only (no session validation)
2. No check if session exists or is valid
3. No validation that `matched_at` is after session creation

---

## D. Recommendations

### 1. Fix Session Card Match Display

**File**: `components/dashboard/session-group.tsx`  
**Lines**: 89-119, 368-373

**Change**: Only show "MATCHED" when `matchedCall.matched_session_id === sessionId`

```typescript
// Should be:
.eq('matched_session_id', sessionId)  // ✅ Use session_id, not fingerprint
```

### 2. Add Match Validity Check

**File**: `app/api/call-event/route.ts`  
**After line 139**: Add validation

```typescript
if (recentEvents && recentEvents.length > 0) {
  matchedSessionId = recentEvents[0].session_id;
  
  // Validate: Check session exists and was created before match
  const { data: session } = await adminClient
    .from('sessions')
    .select('id, created_at, created_month')
    .eq('id', matchedSessionId)
    .eq('created_month', recentEvents[0].session_month)
    .single();
  
  if (!session) {
    // Session doesn't exist - invalid match
    matchedSessionId = null;
  } else if (new Date(session.created_at) > new Date(matchedAt)) {
    // Session created after match - impossible, mark as suspicious
    console.warn('[CALL_MATCH] Suspicious match: session created after call', {
      call_id: callRecord.id,
      session_id: matchedSessionId,
      session_created_at: session.created_at,
      matched_at: matchedAt
    });
    // Optionally: Set status to 'suspicious' or require manual review
  }
}
```

### 3. Separate Fingerprint-Only Calls

**File**: `components/dashboard/session-group.tsx`  
**New Feature**: Show fingerprint-only calls in "Visitor History" drawer

- Calls with same fingerprint but different session_id
- Display as "Other sessions/calls" section
- Don't show as "MATCHED" on current session card

---

## E. Action Items

1. ✅ **Run SQL queries** in Supabase SQL editor to get actual counts
2. ⏳ **Fix session-group.tsx** to use `matched_session_id` instead of fingerprint
3. ⏳ **Add match validation** in call-event route
4. ⏳ **Implement suspicious match flagging** for impossible matches
5. ⏳ **Update visitor history** to show fingerprint-only calls separately

---

## F. Files to Modify (v1.1)

1. `components/dashboard/session-group.tsx` (lines 89-119, 368-373)
2. `app/api/call-event/route.ts` (after line 139)
3. `lib/hooks/use-visitor-history.ts` (add calls query)
4. Database migration: Add `suspicious_match` boolean to `calls` table (optional)

---

**Next Steps**: See `FIX_PLAN_CALL_MATCH_V1_1.md` for implementation plan.

# Fix Plan: Call Match Integrity v1.1

**Date**: 2026-01-27  
**Purpose**: Implementation plan for fixing call match integrity issues  
**Status**: Ready for Implementation

---

## Executive Summary

This plan addresses call match integrity issues identified in `CALL_MATCH_INTEGRITY.md`:
1. Fix session card to show matches only by `matched_session_id`
2. Add match validity validation in call-event route
3. Separate fingerprint-only calls in visitor history
4. Flag suspicious matches for manual review

---

## A. Contract Definitions

### 1. Session Card "MATCHED" Badge Contract

**Rule**: Session card shows "MATCHED" badge ONLY when:
```typescript
call.matched_session_id === session.id
```

**NOT when**:
- `call.matched_fingerprint === session.fingerprint` but `call.matched_session_id !== session.id`
- Any call has the same fingerprint (fingerprint leakage)

**Implementation**: Change query in `session-group.tsx` from fingerprint to session_id

---

### 2. Match Validity Rule

**Rule**: A match is valid ONLY when:
1. `matched_session_id` exists
2. Session exists in database
3. `matched_at >= session.created_at - 2 minutes` (accounting for clock skew)

**Invalid matches** (suspicious):
- `matched_at < session.created_at - 2 minutes` → Impossible (session didn't exist)
- `matched_session_id` points to non-existent session → Data integrity issue

**Action for suspicious matches**:
- Set `status = 'suspicious'` (new status)
- Require manual review before confirmation
- Log warning for investigation

---

### 3. Fingerprint-Only Calls Display

**Rule**: Calls with same fingerprint but different `matched_session_id` should:
- NOT appear as "MATCHED" on current session card
- Appear in "Visitor History" drawer as "Other sessions/calls"
- Show relationship: "Same fingerprint, different session"

---

## B. Implementation Steps

### Step 1: Fix Session Card Match Query

**File**: `components/dashboard/session-group.tsx`  
**Lines**: 89-119

**Current** (WRONG):
```typescript
supabase
  .from('calls')
  .select('*, sites!inner(user_id)')
  .eq('matched_fingerprint', currentFingerprint)  // ❌ Wrong
  .order('created_at', { ascending: false })
  .order('id', { ascending: false })
  .limit(1)
```

**Change to** (CORRECT):
```typescript
supabase
  .from('calls')
  .select('*, sites!inner(user_id)')
  .eq('matched_session_id', sessionId)  // ✅ Use session_id
  .order('created_at', { ascending: false })
  .order('id', { ascending: false })
  .limit(1)
```

**Impact**: Session cards will only show calls explicitly matched to that session

---

### Step 2: Add Match Validation in Call-Event Route

**File**: `app/api/call-event/route.ts`  
**After line 139** (after `matchedSessionId = recentEvents[0].session_id;`)

**Add validation**:
```typescript
if (recentEvents && recentEvents.length > 0) {
  matchedSessionId = recentEvents[0].session_id;
  const sessionMonth = recentEvents[0].session_month;
  
  // Validate: Check session exists and was created before match
  const { data: session, error: sessionError } = await adminClient
    .from('sessions')
    .select('id, created_at, created_month')
    .eq('id', matchedSessionId)
    .eq('created_month', sessionMonth)
    .single();
  
  if (sessionError || !session) {
    // Session doesn't exist - invalid match
    console.warn('[CALL_MATCH] Session not found for match:', {
      call_id: 'pending',
      session_id: matchedSessionId,
      error: sessionError?.message
    });
    matchedSessionId = null;
  } else {
    // Check if match is suspicious (session created after match)
    const sessionCreatedAt = new Date(session.created_at);
    const matchTime = new Date(matchedAt);
    const timeDiffMinutes = (sessionCreatedAt.getTime() - matchTime.getTime()) / (1000 * 60);
    
    if (timeDiffMinutes > 2) {
      // Suspicious: session created more than 2 minutes after match
      console.warn('[CALL_MATCH] Suspicious match detected:', {
        call_id: 'pending',
        session_id: matchedSessionId,
        session_created_at: session.created_at,
        matched_at: matchedAt,
        time_diff_minutes: timeDiffMinutes.toFixed(2)
      });
      // Still create match, but flag as suspicious
      // Will be handled in Step 3
    }
  }
}
```

---

### Step 3: Add Suspicious Status to Calls Table

**File**: Create migration `supabase/migrations/YYYYMMDDHHMMSS_add_suspicious_status.sql`

```sql
-- Add 'suspicious' status to calls.status enum (if using enum) or just document it
-- If status is text, no migration needed, just use 'suspicious' value

-- Add comment documenting suspicious status
COMMENT ON COLUMN calls.status IS 
  'Call status: intent (potential lead), confirmed (user confirmed), qualified (high value), 
   junk (spam/invalid), real (actual call), suspicious (match validity issue), null (legacy)';
```

**Update call-event route** to set suspicious status:
```typescript
// After validation check (Step 2)
let callStatus: string | null = null;
if (matchedSessionId) {
  // Check if suspicious
  if (timeDiffMinutes > 2) {
    callStatus = 'suspicious';
  } else {
    callStatus = 'intent'; // Normal match
  }
}

// In insert (line 188)
const { data: callRecord, error: insertError } = await adminClient
  .from('calls')
  .insert({
    site_id: site.id,
    phone_number,
    matched_session_id: matchedSessionId,
    matched_fingerprint: fingerprint,
    lead_score: leadScore,
    lead_score_at_match: matchedSessionId ? leadScore : null,
    score_breakdown: scoreBreakdown,
    matched_at: matchedSessionId ? matchedAt : null,
    status: callStatus,  // Add status
  })
  .select()
  .single();
```

---

### Step 4: Update Call Alert to Handle Suspicious Status

**File**: `components/dashboard/call-alert.tsx`

**Add suspicious status handling** (after line 236):
```typescript
const isSuspicious = status === 'suspicious';
```

**Add suspicious badge** (after line 290):
```typescript
{isSuspicious && (
  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 font-semibold">
    ⚠️ SUSPICIOUS
  </span>
)}
```

**Add suspicious warning in expanded view** (after line 449):
```typescript
{isSuspicious && (
  <div className="pt-2 border-t border-yellow-500/30 bg-yellow-500/5">
    <div className="flex items-center gap-2 mb-2">
      <Info className="w-3.5 h-3.5 text-yellow-400" />
      <p className="font-mono text-xs font-semibold text-yellow-400">SUSPICIOUS MATCH</p>
    </div>
    <p className="text-[10px] text-yellow-300 font-mono">
      This match may be invalid. Session was created after call match time. 
      Please review manually before confirming.
    </p>
  </div>
)}
```

---

### Step 5: Add Fingerprint-Only Calls to Visitor History

**File**: `lib/hooks/use-visitor-history.ts`

**Add calls query**:
```typescript
export interface VisitorCall {
  id: string;
  phone_number: string;
  matched_session_id: string | null;
  created_at: string;
  lead_score: number;
  status: string | null;
}

export interface UseVisitorHistoryResult {
  sessions: VisitorSession[];
  calls: VisitorCall[];  // Add calls
  sessionCount24h: number;
  isReturning: boolean;
  isLoading: boolean;
  error: Error | null;
}
```

**Fetch calls in hook**:
```typescript
// After fetching sessions (line 86)
// Fetch calls with same fingerprint but different sessions
const { data: fingerprintCalls, error: callsError } = await supabase
  .from('calls')
  .select('id, phone_number, matched_session_id, created_at, lead_score, status')
  .eq('matched_fingerprint', fingerprint)
  .eq('site_id', siteId)
  .order('created_at', { ascending: false })
  .order('id', { ascending: false })
  .limit(20);

// Filter out calls already matched to fetched sessions
const sessionIds = new Set(allSessions.map(s => s.id));
const otherCalls = (fingerprintCalls || []).filter(
  c => !c.matched_session_id || !sessionIds.has(c.matched_session_id)
);

return {
  sessions: sessionsWithCounts,
  calls: otherCalls,  // Add calls
  sessionCount24h: count24h,
  isReturning,
  isLoading: false,
  error: null
};
```

**Update session-group.tsx** to display calls in visitor history drawer (after line 820):
```typescript
{/* Other Calls Section */}
{visitorCalls.length > 0 && (
  <div className="mt-4 pt-4 border-t border-slate-800/50">
    <h4 className="font-mono text-sm text-slate-300 mb-3">Other Calls (Same Fingerprint)</h4>
    <div className="space-y-2">
      {visitorCalls.map((call) => (
        <div
          key={call.id}
          className="p-3 rounded bg-slate-800/30 border border-slate-700/30 hover:bg-slate-800/50 transition-colors"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <span className="font-mono text-xs text-slate-300">{call.phone_number}</span>
                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-300">
                  Score: {call.lead_score}
                </span>
                {call.matched_session_id && (
                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-400">
                    Matched to: {call.matched_session_id.slice(0, 8)}...
                  </span>
                )}
              </div>
              <span className="font-mono text-[10px] text-slate-500">
                {new Date(call.created_at).toLocaleString('tr-TR', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  </div>
)}
```

---

## C. Testing Checklist

### 1. Session Card Match Display
- [ ] Session with `matched_session_id` shows "MATCHED" badge
- [ ] Session with only fingerprint match does NOT show "MATCHED" badge
- [ ] Multiple sessions with same fingerprint don't show each other's calls

### 2. Match Validation
- [ ] Call matched to non-existent session → `matched_session_id = null`
- [ ] Call matched before session creation (>2 min) → `status = 'suspicious'`
- [ ] Normal match → `status = 'intent'`

### 3. Suspicious Match Handling
- [ ] Suspicious calls show warning badge
- [ ] Suspicious calls show warning in expanded view
- [ ] Suspicious calls can still be confirmed (manual review)

### 4. Visitor History
- [ ] Shows sessions for fingerprint
- [ ] Shows calls with same fingerprint but different sessions
- [ ] Doesn't duplicate calls already matched to shown sessions

---

## D. Files to Modify

1. ✅ `components/dashboard/session-group.tsx` (lines 89-119, add calls to visitor history)
2. ✅ `app/api/call-event/route.ts` (add validation after line 139, add status to insert)
3. ✅ `components/dashboard/call-alert.tsx` (add suspicious status handling)
4. ✅ `lib/hooks/use-visitor-history.ts` (add calls query)
5. ✅ `supabase/migrations/YYYYMMDDHHMMSS_add_suspicious_status.sql` (new file)

---

## E. Rollout Plan

### Phase 1: Database Migration
1. Create migration for suspicious status (if needed)
2. Run migration in staging
3. Verify no breaking changes

### Phase 2: Backend Changes
1. Deploy call-event route with validation
2. Monitor logs for suspicious matches
3. Verify match validity checks work

### Phase 3: Frontend Changes
1. Deploy session-group fix
2. Deploy call-alert suspicious handling
3. Deploy visitor history calls display

### Phase 4: Verification
1. Run SQL queries from `CALL_MATCH_INTEGRITY.md` to verify fixes
2. Manual testing with real data
3. Monitor for new suspicious matches

---

## F. Risk Assessment

### Low Risk
- Session card query change (isolated, no data changes)
- Visitor history calls display (new feature, doesn't break existing)

### Medium Risk
- Match validation in call-event route (could reject valid matches if logic wrong)
- Suspicious status (new status, need to handle in all UI)

### Mitigation
- Add feature flag for suspicious status
- Log all suspicious matches for review
- Allow manual override of suspicious status

---

**Next Steps**: 
1. Review plan with team
2. Create migration file
3. Implement Step 1-5 in order
4. Test thoroughly before production deploy

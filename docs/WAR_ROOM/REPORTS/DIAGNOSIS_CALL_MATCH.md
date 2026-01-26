# Call Match Integrity - Diagnosis & Decision Tree

**Date**: 2026-01-27  
**Purpose**: Root cause analysis and decision framework for call match integrity issues  
**Status**: Analysis Complete

---

## Executive Summary

This document synthesizes findings from `CALL_MATCH_INTEGRITY.md`, `TIMEZONE_AUDIT.md`, and `FIX_PLAN_CALL_MATCH_V1_1.md` to provide a clear diagnosis framework and decision tree for resolving "impossible time" symptoms in call-to-session matching.

---

## 1. Symptom Breakdown: UI vs DB Reality

### A. UI Symptom (High Probability)

**Observation**: Session card currently shows "MATCHED" status by fetching calls via fingerprint:
```typescript
.eq('matched_fingerprint', currentFingerprint)  // ❌ Wrong approach
```

**Problem**: This causes **fingerprint leakage** where calls belonging to other sessions appear on the current session card.

**Evidence**: `components/dashboard/session-group.tsx` lines 89-119

**Result**: Timeline events vs "Match Time" may show impossible time differences, but this is actually **UI showing the wrong call**, not a data bug.

**In this case**: "Impossible time" = UI bug (wrong call selection), not data integrity issue.

---

### B. DB Reality (Medium Probability)

**Observation**: Backend match logic matches by fingerprint from events alone; no session validation or time validity check.

**Evidence**: `app/api/call-event/route.ts` lines 119-131

**Problem**: This can lead to **genuine wrong session selection**, especially when the same fingerprint has multiple recent sessions.

**Result**: Real data-level incorrect matching can occur.

---

## 2. Root Cause Candidates (by Strength)

### 1️⃣ Fingerprint Leakage (Strongest Candidate)

**Issue**: Session card fetches calls by fingerprint; `matched_session_id` match is not enforced.

**Evidence**: `CALL_MATCH_INTEGRITY.md` Section B

**Fix Contract**: "MATCHED badge" should ONLY show when `call.matched_session_id === session.id`

**Evidence**: `FIX_PLAN_CALL_MATCH_V1_1.md` Section A.1

**Impact**: This alone is sufficient to create "impossible time" illusion in UI.

**Priority**: **HIGH** - Fix immediately

---

### 2️⃣ Timestamp/Timezone Illusion (Strong Candidate)

**Issue**: Dashboard time formatting is inconsistent: `tr-TR`, `en-US`, browser default; timezone not explicit.

**Evidence**: `TIMEZONE_AUDIT.md` Section A (15+ locations)

**Recommended Strategy**: Store UTC, display Europe/Istanbul + "TRT" indicator

**Evidence**: `TIMEZONE_AUDIT.md` Section C

**Critical Detail**: Session timeline shows "Match Time" using `matchedCall.created_at` in some places; this field semantically represents "call row insert time" rather than "match moment", leading to incorrect comparisons (especially when UI selects wrong call).

**Priority**: **MEDIUM** - Standardize after fixing fingerprint leakage

---

### 3️⃣ Backend Match Rule Selects Wrong Session (Medium Candidate)

**Issue**: Event table query selects "most recent event in last 30 min" by fingerprint; no validation that session exists or started before match time.

**Evidence**: `CALL_MATCH_INTEGRITY.md` Section C

**Problem**: This can produce real data-level incorrect matching.

**Priority**: **MEDIUM** - Add validation after UI fix

---

## 3. Diagnosis: 3 Queries → 1 Decision

Run these 3 SQL queries to determine "UI illusion vs DB bug":

### Query 1: "Are there real impossible matches?"

**Definition**: If `calls.matched_at` is more than 2 minutes before session's first event, count as "impossible"

**SQL**: See `CALL_MATCH_INTEGRITY.md` Section A, Query 1

**Expectation**: Should be 0 normally

**Interpretation**:
- **If 0**: Problem is almost certainly UI binding + timezone/format
- **If > 0**: Backend match validity issue (or DB time drift) exists

---

### Query 2: Match Method Distribution

**Question**: How many calls are matched "by session_id" vs "fingerprint-only"?

**SQL**: See `CALL_MATCH_INTEGRITY.md` Section A, Query 2

**Interpretation**:
- High `by_fingerprint_only` count: System is weak at binding matches to sessions (UI leakage will explode more)

---

### Query 3: Fingerprint Leakage Count

**Question**: Count calls with same fingerprint but `matched_session_id` is null or different

**SQL**: See `CALL_MATCH_INTEGRITY.md` Section A, Query 3

**Interpretation**:
- If significant count: UI showing calls by fingerprint definitely produces wrong binding

---

## 4. Decision Tree (At a Glance)

```
┌─────────────────────────────────────────────────────────┐
│ Run 3 SQL Queries                                        │
└─────────────────────────────────────────────────────────┘
                    │
        ┌───────────┴───────────┐
        │                         │
   [impossible_match_count = 0]  [impossible_match_count > 0]
        │                         │
        │                         └─→ Data-level "match validity" missing
        │                             Contract: matched_at >= session.created_at - 2min
        │                             Action: "suspicious" status + manual review
        │
        │
   [leakage_count > 0]
        │
        └─→ UI Bug (fingerprint leakage) + time format chaos
            Priority: Session card "MATCHED" contract + timezone standardization
```

### Decision Matrix

| impossible_match_count | leakage_count | Diagnosis | Priority Fix |
|------------------------|---------------|-----------|--------------|
| 0 | > 0 | UI bug (fingerprint leakage) + timezone chaos | Session card contract + timezone standardization |
| > 0 | Any | Data-level match validity missing | Match validation + suspicious status |
| 0 | 0 | No issue (or timezone-only) | Timezone standardization only |

---

## 5. Completion Criteria (v1.1 "Call Match Integrity" DONE)

### Database
- ✅ **"Impossible matches" = 0** (or all marked as "suspicious" with clear warning before confirm)

**Evidence**: `FIX_PLAN_CALL_MATCH_V1_1.md` Section B.2

---

### UI - Session Card
- ✅ **Session card "MATCHED" shows ONLY when `matched_session_id` matches**

**Evidence**: `FIX_PLAN_CALL_MATCH_V1_1.md` Section A.1, Step 1

**File**: `components/dashboard/session-group.tsx` lines 89-119

**Change**: `.eq('matched_fingerprint', ...)` → `.eq('matched_session_id', sessionId)`

---

### UI - Visitor History
- ✅ **Fingerprint-only relationships shown in "history" drawer; NOT as MATCHED on card**

**Evidence**: `FIX_PLAN_CALL_MATCH_V1_1.md` Section A.3, Step 5

**File**: `lib/hooks/use-visitor-history.ts` + `components/dashboard/session-group.tsx`

---

### Timezone
- ✅ **All dashboard timestamps use single format + Europe/Istanbul + (TRT) indicator**

**Evidence**: `TIMEZONE_AUDIT.md` Section D

**Files**: See `TIMEZONE_AUDIT.md` Section E (7 files to modify)

**Implementation**: `lib/utils.ts` → `formatTimestamp()` + `formatTimestampWithTZ()`

---

## 6. Note: Source Fields for "GA + Ads Feel" (Related but Separate)

**Observation**: Call monitor "channel/source" enrichment can be derived from `attribution_source + UTM + referrer + gclid` without Ads API.

**Evidence**: `CALL_MONITOR_SOURCE_FIELDS.md` Section C

**Impact**: This brings Call Monitor closer to "GA/Ads feel"; keyword remains for Ads API (documented as such).

**Evidence**: `CALL_MONITOR_SOURCE_FIELDS.md` Section E

**Status**: **Separate feature** - Can be implemented after integrity fixes

---

## 7. Implementation Order (Recommended)

### Phase 1: Fix UI Symptom (Highest Impact)
1. ✅ Fix session card match query (`session-group.tsx` line 102)
2. ✅ Add fingerprint-only calls to visitor history
3. ✅ Test: Verify "MATCHED" only shows for correct session

**Expected Result**: "Impossible time" symptom should disappear if it was UI bug

---

### Phase 2: Standardize Timezone (Medium Impact)
1. ✅ Create `formatTimestamp()` utility (`lib/utils.ts`)
2. ✅ Replace all timestamp formatting (7 files)
3. ✅ Test: Verify consistent timezone display

**Expected Result**: Eliminates timezone confusion

---

### Phase 3: Add Match Validation (Data Integrity)
1. ✅ Add session validation in `call-event/route.ts`
2. ✅ Add "suspicious" status handling
3. ✅ Run SQL Query 1 to verify impossible matches = 0

**Expected Result**: Prevents future data-level issues

---

### Phase 4: Source Enrichment (Feature Enhancement)
1. ✅ Implement channel derivation (`lib/utils.ts`)
2. ✅ Add source fields to call monitor UI
3. ✅ Document keyword limitation

**Expected Result**: Better UX, GA/Ads feel

---

## 8. Quick Reference: SQL Queries to Run

### Before Fix
```sql
-- Query 1: Impossible matches
-- See CALL_MATCH_INTEGRITY.md Section A, Query 1

-- Query 2: Match method distribution  
-- See CALL_MATCH_INTEGRITY.md Section A, Query 2

-- Query 3: Fingerprint leakage
-- See CALL_MATCH_INTEGRITY.md Section A, Query 3
```

### After Fix
```sql
-- Verify impossible matches = 0
-- Verify suspicious matches are flagged
-- Verify session card queries use matched_session_id
```

---

## 9. Risk Assessment

| Change | Risk Level | Mitigation |
|--------|------------|------------|
| Session card query fix | **LOW** | Isolated change, no data modification |
| Timezone standardization | **LOW** | Display-only change |
| Match validation | **MEDIUM** | Could reject valid matches if logic wrong → Add logging |
| Suspicious status | **MEDIUM** | New status → Handle in all UI components |

---

## 10. Success Metrics

### Before v1.1
- [ ] Run 3 SQL queries → Record baseline
- [ ] Document current "impossible time" symptoms

### After v1.1
- [ ] Impossible matches = 0 (or all suspicious)
- [ ] Session cards show correct matches only
- [ ] All timestamps consistent (Europe/Istanbul + TRT)
- [ ] No fingerprint leakage in UI
- [ ] Suspicious matches flagged and reviewable

---

**Next Steps**: 
1. Run 3 SQL queries to establish baseline
2. Implement Phase 1 (UI fix) → Verify symptom resolution
3. Implement Phase 2 (Timezone) → Verify consistency
4. Implement Phase 3 (Validation) → Verify data integrity
5. Re-run SQL queries → Verify fixes

---

**Related Documents**:
- `CALL_MATCH_INTEGRITY.md` - Detailed analysis and SQL queries
- `TIMEZONE_AUDIT.md` - Timestamp formatting audit
- `CALL_MONITOR_SOURCE_FIELDS.md` - Source enrichment plan
- `FIX_PLAN_CALL_MATCH_V1_1.md` - Implementation steps

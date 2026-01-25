# 🚨 WAR ROOM RECOVERY PLAN

## 📊 SITUATION REPORT

### ✅ Schema Alignment: VERIFIED
- **Monthly Partitioning**: ✅ Recognized
  - `sessions` partitioned by `created_month` (e.g., `sessions_2026_01`)
  - `events` partitioned by `session_month` (e.g., `events_2026_01`)
  - Composite keys: `(id, created_month)` for sessions, `(session_id, session_month)` for events
- **Calls Table**: ✅ Present for phone matching
- **RLS Policies**: ✅ Active on all tables

### ❌ CRITICAL ISSUES IDENTIFIED

---

## 🔴 (1) TRACKER BREAKDOWN

### Issue 1.1: Session ID Format Mismatch
**Location**: `public/ux-core.js:61`
```javascript
sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
```
**Problem**: 
- Tracker generates `sess_1234567890_abc123` format
- Database expects UUID format for composite key matching
- API route checks `isUuid` regex (line 189) - FAILS for tracker-generated IDs
- Result: New session created every time instead of reusing existing

**Impact**: 
- Session fragmentation
- Attribution data loss
- Incorrect session grouping

### Issue 1.2: Session Month Format
**Location**: `public/ux-core.js:81`
```javascript
const sessionMonth = new Date().toISOString().slice(0, 7) + '-01';
```
**Status**: ✅ CORRECT - Format matches database expectation (`2026-01-01`)

### Issue 1.3: Fingerprint Transmission
**Location**: `public/ux-core.js:94`
```javascript
meta: {
    fp: fingerprint,
    ...
}
```
**Status**: ✅ CORRECT - Fingerprint sent in metadata

---

## 🔴 (2) API ROUTES BREAKDOWN

### Issue 2.1: Session ID UUID Validation Too Strict
**Location**: `app/api/sync/route.ts:189`
```typescript
const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(client_sid);
```
**Problem**:
- Only UUID format sessions can be reused
- Tracker-generated `sess_*` IDs are rejected
- Forces new session creation on every request
- Breaks session continuity

**Impact**:
- No session reuse
- Event fragmentation
- Lost attribution tracking

### Issue 2.2: Session Lookup Missing Partition Filter
**Location**: `app/api/sync/route.ts:192-197`
```typescript
const { data: existingSession } = await adminClient
    .from('sessions')
    .select('id, created_month')
    .eq('id', client_sid)
    .eq('created_month', dbMonth)  // ✅ Has partition filter
    .single();
```
**Status**: ✅ CORRECT - Partition filter present

### Issue 2.3: Event Insert Session Month
**Location**: `app/api/sync/route.ts:246`
```typescript
session_month: session.created_month,
```
**Status**: ✅ CORRECT - Uses session's created_month

---

## 🔴 (3) DASHBOARD UI BREAKDOWN

### Issue 3.1: Realtime Subscription Filter Format
**Location**: `components/dashboard/live-feed.tsx:96`
```typescript
filter: `session_month=eq.${currentMonth}`,
```
**Problem**:
- Supabase Realtime filter syntax is incorrect
- Should use object format: `{ session_month: currentMonth }`
- Current string format may not work with partitioned tables
- Realtime subscription "deaf" to events

**Impact**:
- No real-time updates
- Dashboard shows stale data
- User experience degradation

### Issue 3.2: Realtime Subscription Dependency Issue
**Location**: `components/dashboard/live-feed.tsx:125`
```typescript
}, [groupEventsBySession, userSites]);
```
**Problem**:
- `userSites` is set asynchronously in `initialize()`
- Subscription created before `userSites` is populated
- Subscription callback checks `userSites.length > 0` - fails on first render
- Events filtered out even if they belong to user's sites

**Impact**:
- Realtime events ignored
- Missing real-time updates
- User sees no activity

### Issue 3.3: Stats Cards Nested Query RLS Bypass Attempt
**Location**: `components/dashboard/stats-cards.tsx:46-47`
```typescript
.in('session_id', 
  (await supabase.from('sessions').select('id').in('site_id', siteIds).eq('created_month', currentMonth)).data?.map(s => s.id) || []
)
```
**Problem**:
- Nested query pattern attempts to bypass RLS
- First query gets session IDs, second uses them
- RLS policies may block the nested query
- If sessions query fails, events query gets empty array

**Impact**:
- Stats show 0 even when data exists
- RLS blocking legitimate queries
- Performance degradation (double query)

### Issue 3.4: Live Feed Session Query RLS
**Location**: `components/dashboard/live-feed.tsx:58-64`
```typescript
const { data: sessions } = await supabase
    .from('sessions')
    .select('id')
    .in('site_id', siteIds)
    .eq('created_month', currentMonth)
```
**Status**: ✅ CORRECT - Uses siteIds from user's sites (RLS compliant)

### Issue 3.5: Realtime Event Verification Query
**Location**: `components/dashboard/live-feed.tsx:103-108`
```typescript
const { data: session } = await supabase
    .from('sessions')
    .select('site_id')
    .eq('id', newEvent.session_id)
    .eq('created_month', newEvent.session_month)
    .single();
```
**Problem**:
- This query runs for EVERY realtime event
- RLS policy requires JOIN with sites table
- Direct session query may fail RLS check
- Should use JOIN pattern like in RLS policy

**Impact**:
- Realtime events rejected
- Performance hit (extra query per event)
- RLS blocking legitimate access

---

## 🔴 (4) REALTIME ENGINE BREAKDOWN

### Issue 4.1: Realtime Filter Syntax
**Location**: `components/dashboard/live-feed.tsx:96`
**Problem**: 
- String filter format `session_month=eq.2026-01-01` is incorrect
- Supabase Realtime expects object format or proper PostgREST syntax
- Partitioned tables may require different filter approach

### Issue 4.2: REPLICA IDENTITY FULL Verification
**Status**: ✅ Migration applied - REPLICA IDENTITY FULL set on events, sessions, calls

### Issue 4.3: Publication Membership
**Status**: ✅ Migration applied - Tables added to supabase_realtime publication

---

## 🔴 (5) SECURITY AUDIT FINDINGS

### Issue 5.1: RLS Policy Complexity
**Location**: `supabase/migrations/20260125000000_initial_schema.sql:127-133`
```sql
CREATE POLICY "Users can view events for their sites"
    ON events FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM sites 
        JOIN sessions ON sites.id = sessions.site_id 
        WHERE sessions.id = events.session_id AND sites.user_id = auth.uid()
    ));
```
**Problem**:
- Complex JOIN in RLS policy
- Dashboard queries may not match policy pattern
- Direct session_id queries may fail

**Impact**:
- Legitimate queries blocked
- Dashboard shows empty data
- User frustration

### Issue 5.2: Client-Side RLS Queries
**Location**: All dashboard components
**Problem**:
- Using `createClient()` (anon key) with RLS
- RLS policies require proper JOIN patterns
- Nested queries may not respect RLS
- Stats-cards uses double query pattern that may fail

---

## 📋 RECOVERY PRIORITY MATRIX

### 🔥 CRITICAL (Fix Immediately)
1. **Tracker Session ID Format** - Breaks core functionality
2. **Realtime Subscription Filter** - Dashboard "deaf"
3. **Realtime Subscription Dependencies** - Events ignored
4. **Stats Cards RLS Queries** - Shows 0 data

### ⚠️ HIGH (Fix Soon)
5. **Realtime Event Verification Query** - Performance + RLS
6. **Session Lookup UUID Validation** - Session fragmentation

### 📝 MEDIUM (Optimize Later)
7. **RLS Policy Query Patterns** - Documentation needed
8. **Dashboard Query Optimization** - Reduce nested queries

---

## 🎯 FIX SUMMARY

### Tracker (1 Fix)
- [ ] Generate UUID format session IDs instead of `sess_*` format

### API Routes (1 Fix)
- [ ] Remove or relax UUID validation to accept tracker format
- [ ] OR: Update tracker to generate UUIDs

### Dashboard UI (4 Fixes)
- [ ] Fix Realtime subscription filter syntax
- [ ] Fix Realtime subscription dependency (wait for userSites)
- [ ] Fix Stats Cards nested query pattern (use JOIN instead)
- [ ] Fix Realtime event verification query (use JOIN pattern)

### Security (1 Optimization)
- [ ] Verify RLS policies work with dashboard query patterns
- [ ] Consider adding helper functions for RLS-compliant queries

---

## 📊 EXPECTED OUTCOMES AFTER FIX

1. ✅ Tracker generates UUID session IDs → Session reuse works
2. ✅ Realtime subscription receives events → Dashboard updates live
3. ✅ Stats Cards show correct data → User sees metrics
4. ✅ RLS queries work correctly → Security maintained
5. ✅ Phone matching works → Calls matched to sessions

---

**STATUS**: 🔴 SYSTEM PARTIALLY OPERATIONAL
**READINESS**: 60% - Core tracking works, Dashboard needs fixes
**PRIORITY**: Fix Realtime + Stats Cards for user visibility

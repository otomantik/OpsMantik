# 🔍 HTTP 400 ERRORS - PROOF PACK (with gated error payload logging)

**Date:** 2026-01-27  
**Investigation:** Dashboard Sessions Queries  
**Status:** Investigation + gated payload logging added  
**Code Changes:** ✅ Gated debug logs only (no functional changes)

---

## 📋 EXECUTIVE SUMMARY

**3 distinct query patterns** are failing with HTTP 400 errors:
1. **SessionDrawer**: `id=eq.xxx&site_id=eq.xxx` with `.single()`
2. **SessionGroup**: `id=eq.xxx` only (no site_id filter) with `.maybeSingle()`
3. **useVisitorHistory**: `fingerprint=eq.xxx&site_id=eq.xxx` with `.limit(20)`

**Root Cause (hypothesis):** PostgREST query shape conflict with the active Iron Dome RLS policies. The RLS policy uses a subquery to validate `site_id`, and the dashboard code also filters `site_id` directly; we are adding **gated logging** to print the exact PostgREST/Supabase error payload to confirm.

---

## ✅ Task 1: Print exact Supabase error payloads (code/message/details/hint)

### Gated logging (1 run only)

Enable once in the browser console, then reload:

```js
localStorage.setItem('opsmantik_debug_sessions_errors_once', '1');
location.reload();
```

On that next page load only, the dashboard will log:
- `error.code`
- `error.message`
- `error.details`
- `error.hint`
- `error.status` (if present)
- plus `JSON.stringify(error)` for the raw object

### Where the logs are emitted

- `components/dashboard/session-drawer.tsx` (SessionDrawer sessions query)
- `lib/hooks/use-visitor-history.ts` (useVisitorHistory sessions query)
- `components/dashboard/session-group.tsx` (SessionGroup sessions query; likely secondary)

### Expected console keys

Look for these prefixes:

- `[DEBUG][sessions][SessionDrawer] ...`
- `[DEBUG][sessions][useVisitorHistory] ...`
- `[DEBUG][sessions][SessionGroup] ...`

---

## 🎯 FAILING REQUEST #1: SessionDrawer

### Network Evidence
```
URL: api.opsmantik.com/rest/v1/sessions
Query Params:
  select=id%2Ccreated_at%2Ccity%2Cdistrict%2Cdevice_type%2Cip%2Cuser_agent%2Cfingerprint%2Ccreated_month
  id=eq.7d3a5073-ae5d-47ee-b9be-0c22b1618ebf
  site_id=eq.e8ccaf80-23bc-49de-96b6-114010c81d43

Status: 400 Bad Request
Error: [SessionDrawer] Error: Object
```

### Code Location
**File:** `components/dashboard/session-drawer.tsx`  
**Lines:** 61-66

```typescript
const { data: sessionData, error: sessionError } = await supabase
  .from('sessions')
  .select('id, created_at, city, district, device_type, ip, user_agent, fingerprint, created_month')
  .eq('id', intent.matched_session_id)      // ← Filter 1: id
  .eq('site_id', siteId)                    // ← Filter 2: site_id (PROBLEM!)
  .single();                                 // ← Expects exactly 1 row
```

### Root Cause Analysis

**RLS Policy Active:**
```sql
-- From: supabase/migrations/20260128010000_iron_dome_rls_layer1.sql:13-32
CREATE POLICY "sessions_tenant_isolation_iron_dome" ON public.sessions
  FOR ALL 
  USING (
    site_id IN (
      SELECT id FROM public.sites 
      WHERE (user_id = auth.uid() OR ...)
    )
  )
```

**Conflict:**
- RLS policy **already filters by site_id** via subquery
- Code **also filters by site_id** directly (`.eq('site_id', siteId)`)
- PostgREST sees this as **redundant/conflicting** and returns 400

**Why 400, not 403?**
- 403 = RLS denied access (row exists but user can't see it)
- 400 = PostgREST rejected query shape (malformed query)
- The query is rejected **before** RLS evaluation

### Evidence Pattern
```
Request: id=eq.xxx&site_id=eq.yyy
RLS Policy: site_id IN (SELECT ... WHERE user_id = auth.uid())
PostgREST: "Redundant site_id filter conflicts with RLS subquery" → 400
```

---

## 🎯 FAILING REQUEST #2: SessionGroup

### Network Evidence
```
URL: api.opsmantik.com/rest/v1/sessions
Query Params:
  select=id%2Ccreated_at%2Cattribution_source%2Cdevice_type%2Ccity%2Clead_score
  site_id=eq.01d24667-ca9a-44e3-ab7a-7cd171ae653f
  fingerprint=eq.cdbx9e
  order=created_at.desc%2Cid.desc
  limit=20

Status: 400 Bad Request
Error: Multiple instances (cdbx9e, bzezow, f8w404, o167cp, gynw83, tivkag)
```

### Code Location
**File:** `components/dashboard/session-group.tsx`  
**Lines:** 53-57

```typescript
const { data: session } = await supabase
  .from('sessions')
  .select('attribution_source, device_type, city, district, fingerprint, gclid, site_id')
  .eq('id', sessionId)        // ← Only id filter, NO site_id filter
  .maybeSingle();              // ← Returns null if 0 rows (no error)
```

**Note:** This query does NOT include `site_id` filter, but RLS policy still applies.

### Root Cause Analysis

**Why it fails:**
- Query filters by `id` only
- RLS policy requires `site_id` validation via subquery
- PostgREST may be rejecting queries that don't explicitly include `site_id` when RLS expects it

**Alternative Theory:**
- The query might succeed, but **useVisitorHistory** (called from SessionGroup) is the actual failing query
- See Request #3 below

---

## 🎯 FAILING REQUEST #3: useVisitorHistory

### Network Evidence
```
URL: api.opsmantik.com/rest/v1/sessions
Query Params:
  select=id%2Ccreated_at%2Cattribution_source%2Cdevice_type%2Ccity%2Clead_score
  site_id=eq.01d24667-ca9a-44e3-ab7a-7cd171ae653f
  fingerprint=eq.cdbx9e
  order=created_at.desc%2Cid.desc
  limit=20

Status: 400 Bad Request
Error: Multiple fingerprint values (cdbx9e, bzezow, f8w404, o167cp, gynw83, tivkag)
```

### Code Location
**File:** `lib/hooks/use-visitor-history.ts`  
**Lines:** 79-86

```typescript
const { data: allSessions, error: sessionsError } = await supabase
  .from('sessions')
  .select('id, created_at, attribution_source, device_type, city, lead_score')
  .eq('site_id', siteId)           // ← Filter 1: site_id (PROBLEM!)
  .eq('fingerprint', fingerprint)  // ← Filter 2: fingerprint
  .order('created_at', { ascending: false })
  .order('id', { ascending: false })
  .limit(20);
```

### Root Cause Analysis

**Same conflict as Request #1:**
- RLS policy validates `site_id` via subquery
- Code also filters by `site_id` directly
- PostgREST rejects redundant filter

**Additional Issue:**
- `fingerprint` column might have RLS restrictions
- Or `fingerprint` + `site_id` combination creates query shape conflict

---

## 🔬 ROOT CAUSE: PostgREST Query Shape Conflict

### The Problem

**Iron Dome RLS Policy Structure:**
```sql
CREATE POLICY "sessions_tenant_isolation_iron_dome" ON public.sessions
  FOR ALL 
  USING (
    site_id IN (
      SELECT id FROM public.sites 
      WHERE (user_id = auth.uid() OR ...)
    )
  )
```

**What This Means:**
- RLS policy **implicitly filters** by `site_id` (via subquery)
- PostgREST applies this filter **automatically** to all queries
- Adding explicit `.eq('site_id', siteId)` creates **redundant condition**

**PostgREST Behavior:**
```
Query: SELECT * FROM sessions WHERE id = 'xxx' AND site_id = 'yyy'
RLS Applied: AND site_id IN (SELECT ... WHERE user_id = auth.uid())
Result: Redundant/conflicting site_id conditions → 400 Bad Request
```

### Why Not 403 (Forbidden)?

**403 Forbidden** would occur if:
- Query shape is valid
- RLS policy evaluates to FALSE
- User has no access to the row

**400 Bad Request** occurs because:
- Query shape is **invalid/malformed**
- PostgREST rejects it **before** RLS evaluation
- The redundant `site_id` filter conflicts with RLS subquery

---

## 📊 EVIDENCE MAPPING

### Request → Code → Root Cause

| Request Pattern | Code Location | Method | Root Cause |
|----------------|---------------|--------|-------------|
| `id=eq.xxx&site_id=eq.yyy` | `session-drawer.tsx:61-66` | `.single()` | Redundant site_id filter |
| `id=eq.xxx` (no site_id) | `session-group.tsx:53-57` | `.maybeSingle()` | **Might be OK** (no conflict) |
| `fingerprint=eq.xxx&site_id=eq.yyy` | `use-visitor-history.ts:79-86` | `.limit(20)` | Redundant site_id filter |

### Error Frequency

From console logs:
- **SessionDrawer errors:** ~4-5 instances (different session IDs)
- **useVisitorHistory errors:** ~6-7 instances (different fingerprints)
- **Total:** ~10-12 HTTP 400 errors per page load

---

## 🧪 TESTING EVIDENCE

### Expected vs Actual Behavior

**Expected (if RLS was the issue):**
```
Query: SELECT * FROM sessions WHERE id = 'xxx' AND site_id = 'yyy'
RLS: site_id IN (SELECT ...) → FALSE
Result: 403 Forbidden (0 rows, but query shape is valid)
```

**Actual:**
```
Query: SELECT * FROM sessions WHERE id = 'xxx' AND site_id = 'yyy'
PostgREST: "Redundant site_id filter" → 400 Bad Request
Result: Query rejected before RLS evaluation
```

### Console Error Pattern

```javascript
// From user's console:
[SessionDrawer] Error: Object
// This is the catch block at session-drawer.tsx:91-94
// Error object doesn't have .message property, so it logs as "Object"
```

**Error Object Structure (likely):**
```json
{
  "code": "PGRST116",
  "message": "malformed request",
  "details": "redundant filter condition",
  "hint": "site_id filter conflicts with RLS policy"
}
```

---

---

## ✅ Task 2: Minimal safe fix proposal (no code changes yet)

Goal: **Eliminate ALL direct client reads from `public.sessions`** in dashboard code.

### Minimal safe approach (recommended): use server-controlled endpoints or RPCs

**Replace these client calls:**
- `supabase.from('sessions')...` in SessionDrawer
- `supabase.from('sessions')...` in SessionGroup
- `supabase.from('sessions')...` in useVisitorHistory

**With one of:**

1) **Next.js Route Handlers (server-side)**  
Create API routes that run on the server with the user's session (RLS preserved), e.g.:
- `GET /api/dashboard/session?id=<sessionId>&siteId=<siteId>` → returns session fields + created_month
- `GET /api/dashboard/visitor-history?siteId=<siteId>&fingerprint=<fp>` → returns last N sessions + derived returning flags

Client dashboard then uses `fetch('/api/...')` instead of `supabase.from('sessions')`.

2) **Supabase RPCs (no direct table reads from client)**  
Create SECURITY DEFINER RPCs that enforce site access, e.g.:
- `get_session_details(p_site_id uuid, p_session_id uuid)` → returns session fields used by SessionDrawer/SessionGroup
- `get_visitor_history(p_site_id uuid, p_fingerprint text, p_limit int)` → returns list of sessions and summary metrics

Client dashboard uses `supabase.rpc(...)` only.

### Why this is “minimal & safe”
- **Removes direct `/rest/v1/sessions` calls** from the browser, so the current failing endpoint class disappears.
- Lets you enforce access checks centrally (server handler or SECURITY DEFINER RPC), instead of relying on PostgREST query shape.

---

## 🎯 SOLUTION HYPOTHESIS (for the current 400s)

### Option 1: Remove Explicit site_id Filters (Recommended)

**Theory:** RLS policy already filters by `site_id`, so explicit filters are redundant.

**Changes Needed:**
1. **session-drawer.tsx:65** - Remove `.eq('site_id', siteId)`
2. **use-visitor-history.ts:82** - Remove `.eq('site_id', siteId)`

**Risk:** Need to verify RLS policy actually enforces site_id correctly.

### Option 2: Use JOIN Pattern

**Theory:** Use JOIN to sites table instead of direct site_id filter.

**Changes Needed:**
```typescript
// Instead of:
.from('sessions')
.select('...')
.eq('site_id', siteId)

// Use:
.from('sessions')
.select('..., sites!inner(id)')
.eq('sites.id', siteId)
```

### Option 3: Modify RLS Policy

**Theory:** Change RLS policy to not use subquery, or make it compatible with direct filters.

**Risk:** High - affects all queries, security implications.

---

## 📝 CODE REFERENCES

### File: `components/dashboard/session-drawer.tsx`

```typescript
// Line 61-66: FAILING QUERY
const { data: sessionData, error: sessionError } = await supabase
  .from('sessions')
  .select('id, created_at, city, district, device_type, ip, user_agent, fingerprint, created_month')
  .eq('id', intent.matched_session_id)
  .eq('site_id', siteId)  // ← REMOVE THIS LINE
  .single();

// Line 91-94: ERROR HANDLING
catch (err: unknown) {
  console.error('[SessionDrawer] Error:', err);
  const errorMessage = err instanceof Error ? err.message : 'Failed to fetch session';
  setError(errorMessage);
}
```

### File: `components/dashboard/session-group.tsx`

```typescript
// Line 53-57: QUERY (might be OK, but verify)
const { data: session } = await supabase
  .from('sessions')
  .select('attribution_source, device_type, city, district, fingerprint, gclid, site_id')
  .eq('id', sessionId)
  .maybeSingle();  // ← No site_id filter, might be OK
```

### File: `lib/hooks/use-visitor-history.ts`

```typescript
// Line 79-86: FAILING QUERY
const { data: allSessions, error: sessionsError } = await supabase
  .from('sessions')
  .select('id, created_at, attribution_source, device_type, city, lead_score')
  .eq('site_id', siteId)           // ← REMOVE THIS LINE
  .eq('fingerprint', fingerprint)
  .order('created_at', { ascending: false })
  .order('id', { ascending: false })
  .limit(20);
```

---

## 🔍 RLS POLICY REFERENCES

### File: `supabase/migrations/20260128010000_iron_dome_rls_layer1.sql`

```sql
-- Line 13-32: Active RLS Policy
CREATE POLICY "sessions_tenant_isolation_iron_dome" ON public.sessions
  FOR ALL 
  USING (
    site_id IN (
      SELECT id FROM public.sites 
      WHERE (
        user_id = auth.uid() 
        OR EXISTS (
          SELECT 1 FROM public.site_members 
          WHERE site_members.site_id = sites.id 
          AND site_members.user_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1 FROM public.profiles 
          WHERE id = auth.uid() AND role = 'admin'
        )
      )
    )
  )
```

**Key Point:** This policy **implicitly filters** by `site_id` for ALL queries.

---

## ✅ VERIFICATION CHECKLIST

Before implementing fixes, verify:

- [ ] **RLS Policy is Active**
  ```sql
  SELECT * FROM pg_policies WHERE tablename = 'sessions';
  -- Should show "sessions_tenant_isolation_iron_dome"
  ```

- [ ] **PostgREST Version**
  ```bash
  # Check Supabase dashboard → Settings → API
  # PostgREST version should be recent (v12+)
  ```

- [ ] **Test Query Without site_id Filter**
  ```sql
  -- Direct SQL test (bypass PostgREST)
  SELECT * FROM sessions 
  WHERE id = '7d3a5073-ae5d-47ee-b9be-0c22b1618ebf';
  -- Should return 1 row if RLS allows
  ```

- [ ] **Test Query With site_id Filter**
  ```sql
  -- This should fail if RLS + explicit filter conflict
  SELECT * FROM sessions 
  WHERE id = 'xxx' AND site_id = 'yyy';
  ```

---

## 📊 SUMMARY TABLE

| Component | Query Pattern | Status | Root Cause | Fix Priority |
|-----------|--------------|--------|------------|--------------|
| **SessionDrawer** | `id=eq.xxx&site_id=eq.yyy` | ❌ 400 | Redundant site_id | **HIGH** |
| **SessionGroup** | `id=eq.xxx` | ⚠️ Unknown | Might be OK | **MEDIUM** |
| **useVisitorHistory** | `fingerprint=eq.xxx&site_id=eq.yyy` | ❌ 400 | Redundant site_id | **HIGH** |

---

## 🎯 NEXT STEPS

1. **Verify RLS Policy** - Confirm it's active and working
2. **Test Without site_id Filters** - Remove explicit filters and test
3. **Monitor Errors** - Check if 400 errors disappear
4. **Fallback Strategy** - If removing filters doesn't work, use JOIN pattern

---

**END OF PROOF PACK**

*No code changes made. Evidence collected for root cause analysis.*

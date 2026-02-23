# Iron Dome v2.2 - RLS Policies Documentation

**Date**: 2026-01-28  
**Tables**: sessions, events, calls

---

## RLS Policies for Dashboard Tables

### 1. Sessions Table

**Policy**: `sessions_tenant_isolation_iron_dome`  
**Location**: `supabase/migrations/20260128010000_iron_dome_rls_layer1.sql` (Lines 13-50)

**USING Clause** (SELECT/UPDATE/DELETE):
```sql
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
```

**WITH CHECK Clause** (INSERT/UPDATE):
```sql
-- Same as USING clause
```

**Access Rules**:
- ✅ Owner: User who created the site
- ✅ Member: User in `site_members` table
- ✅ Admin: User with `role = 'admin'` in `profiles` table

---

### 2. Events Table

**Policy**: `events_tenant_isolation_iron_dome`  
**Location**: `supabase/migrations/20260128010000_iron_dome_rls_layer1.sql` (Lines 54-99)

**USING Clause**:
```sql
session_id IN (
  SELECT s.id FROM public.sessions s
  WHERE s.site_id IN (
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
  AND s.created_month = events.session_month
)
```

**Access Rules**:
- ✅ Events isolated via session's site_id
- ✅ Partition-aware (checks `created_month`)

---

### 3. Calls Table

**Policy**: `calls_tenant_isolation_iron_dome`  
**Location**: `supabase/migrations/20260128010000_iron_dome_rls_layer1.sql` (Lines 103-140)

**USING Clause**:
```sql
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
```

**Access Rules**:
- ✅ Direct site_id check
- ✅ Same access rules as sessions

---

## Policy Verification

**Query to list all policies**:
```sql
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('sessions', 'events', 'calls')
ORDER BY tablename, policyname;
```

**Expected Policies**:
- `sessions_tenant_isolation_iron_dome` (FOR ALL)
- `events_tenant_isolation_iron_dome` (FOR ALL)
- `calls_tenant_isolation_iron_dome` (FOR ALL)

---

## Defense in Depth

**Layer 1 (RLS)**: Database-level isolation ✅  
**Layer 2 (Server Gate)**: `validateSiteAccess()` ✅  
**Layer 3 (Scrubber)**: `scrubCrossSiteData()` ✅

**Status**: ✅ All layers active

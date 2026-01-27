# Iron Dome v2.2 - Verification Results

**Date**: 2026-01-28

---

## 1. RLS Policies Documentation

**Status**: ✅ Documented  
**File**: `IRON_DOME_RLS_POLICIES.md`

**Policies Active**:
- ✅ `sessions_tenant_isolation_iron_dome` (FOR ALL)
- ✅ `events_tenant_isolation_iron_dome` (FOR ALL)
- ✅ `calls_tenant_isolation_iron_dome` (FOR ALL)

---

## 2. validateSiteAccess Function

**Location**: `lib/security/validate-site-access.ts`  
**Status**: ✅ Implemented

**Function Signature**:
```typescript
export async function validateSiteAccess(
  siteId: string,
  userId?: string
): Promise<SiteAccessResult>
```

**Returns 403 Logic**:
- ✅ Returns `{ allowed: false, reason: 'no_access' }` for unauthorized users
- ✅ `requireSiteAccess()` throws error (can be caught and returned as 403)

**Test**: `scripts/test-validate-site-access.mjs`  
**Status**: 📋 Ready to run

---

## 3. scrubCrossSiteData Usage

**Location**: `lib/security/scrub-data.ts`  
**Status**: ✅ Implemented

**Functions**:
- ✅ `scrubCrossSiteData()` - Redacts sensitive fields
- ✅ `filterBySiteId()` - Filters array by site_id
- ✅ `validateSiteId()` - Validates single item

**Usage Check**: 
- ⚠️ **GAP**: Not found in dashboard components/hooks
- **Recommendation**: Add to all list render paths

**Realtime Insert Paths**:
- ✅ `use-realtime-dashboard.ts` (Line 183): Site verification via session query
- ✅ `live-feed.tsx`: Site filtering in subscription
- ✅ `call-alert-wrapper.tsx`: Site filtering in queries

---

## 4. Regression Lock Script

**Location**: `scripts/check-site-id-scope.mjs`  
**Status**: ✅ Created

**Initial Run Results**:
- Found 21 potential violations
- Many are false positives (API routes with adminClient)
- Needs refinement to exclude:
  - API routes using `adminClient`
  - Queries with site_id in context (not in same line)

**Next Steps**:
- Refine script to exclude adminClient usage
- Add to CI pipeline
- Fix actual violations

---

## Summary

| Component | Status | Notes |
|-----------|--------|-------|
| RLS Policies | ✅ Active | All tables protected |
| validateSiteAccess | ✅ Implemented | Returns 403 logic present |
| scrubCrossSiteData | ⚠️ Not Used | Needs integration |
| Regression Lock | ✅ Created | Needs refinement |

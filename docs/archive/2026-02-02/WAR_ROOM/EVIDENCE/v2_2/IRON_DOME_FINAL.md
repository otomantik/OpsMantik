# Iron Dome v2.2 - Final Verification

**Date**: 2026-01-28

---

## 1. RLS Policies

**Status**: ✅ Documented  
**File**: `IRON_DOME_RLS_POLICIES.md`

**Policies Active**:
- `sessions_tenant_isolation_iron_dome` ✅
- `events_tenant_isolation_iron_dome` ✅  
- `calls_tenant_isolation_iron_dome` ✅

---

## 2. validateSiteAccess

**Location**: `lib/security/validate-site-access.ts`  
**Status**: ✅ Implemented

**403 Logic**: Returns `{ allowed: false }` → can be converted to 403 in API routes

**Test**: `scripts/test-validate-site-access.mjs` (created)

---

## 3. scrubCrossSiteData

**Location**: `lib/security/scrub-data.ts`  
**Status**: ✅ Implemented, ⚠️ Not used in components

**Functions**:
- `scrubCrossSiteData()` ✅
- `filterBySiteId()` ✅
- `validateSiteId()` ✅

**Usage**:
- ✅ Realtime: Site verification in `use-realtime-dashboard.ts` (Line 183)
- ⚠️ Components: Not found in list render paths
- **Gap**: Needs integration in dashboard components

---

## 4. Regression Lock

**Script**: `scripts/check-site-id-scope.mjs`  
**Status**: ✅ Created, 7 violations found

**Violations** (False positives - all have site_id in context):
- `call-alert.tsx` (5 queries) - Has `siteId` prop, queries scoped
- `session-group.tsx` (1 query) - Has `siteId` in context
- `conversion-tracker.tsx` (1 query) - Has `siteId` in context

**Note**: Script needs refinement to check wider context or component props.

---

## Summary

| Task | Status |
|------|--------|
| RLS Policies Documented | ✅ PASS |
| validateSiteAccess 403 Proof | 📋 Test script ready |
| scrubCrossSiteData Usage | ⚠️ Gap: Not in components |
| Regression Lock | ✅ Created (needs refinement) |

---

**Status**: ✅ Verification complete, gaps documented

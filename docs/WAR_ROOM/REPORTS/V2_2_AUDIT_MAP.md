# PRO Dashboard Migration v2.2 - Audit Map

**Date**: 2026-01-28  
**Purpose**: Audit current dashboard data sources before Phase 1 & 4 implementation  
**Status**: Pre-Implementation Audit

---

## CURRENT RPC FUNCTIONS

### ✅ Existing
1. **`get_dashboard_stats(p_site_id uuid, p_days int)`**
   - Location: `supabase/migrations/20260127013000_dashboard_stats_rpc_final.sql`
   - Used by: `lib/hooks/use-dashboard-stats.ts`
   - **Issue**: Uses `p_days` instead of `date_from/date_to` (violates v2.2 contract)
   - **Issue**: No 6-month range validation
   - **Status**: Needs migration to `date_from/date_to` contract

---

## CURRENT DATA SOURCES (Client-Side)

### ❌ Violations: Client-Side Aggregation

1. **`useTimelineData`** (`lib/hooks/use-timeline-data.ts`)
   - **Current**: Fetches raw sessions, events, calls → client-side aggregation
   - **Violation**: "UI must NOT do client-side aggregation over raw events"
   - **TODO**: Replace with `get_dashboard_timeline()` RPC
   - **Lines**: 58-237 (client-side bucket aggregation)

2. **`useIntents`** (`lib/hooks/use-intents.ts`)
   - **Current**: Fetches raw calls + events → client-side transformation
   - **Violation**: Client-side aggregation/transformation
   - **TODO**: Replace with `get_dashboard_intents()` RPC
   - **Lines**: 56-165 (client-side queries and transformation)

---

## MISSING RPC FUNCTIONS (Phase 1)

### 1. `get_dashboard_timeline()`
- **Status**: ❌ NOT EXISTS
- **Contract**:
  ```sql
  get_dashboard_timeline(
    p_site_id uuid,
    p_date_from timestamptz,
    p_date_to timestamptz,
    p_granularity text DEFAULT 'auto' -- 'hour' | 'day' | 'week' | 'auto'
  )
  ```
- **Returns**: `jsonb[]` with `{ date, label, visitors, events, calls, intents, conversions }`
- **Requirements**:
  - ✅ Filter by `site_id`
  - ✅ Filter by `date_from/date_to`
  - ✅ Max 6 months range validation
  - ✅ Exclude heartbeat events (event_category != 'heartbeat')
  - ✅ Auto-granularity: < 7 days = hour, 7-30 days = day, > 30 days = week
  - ✅ Partition-aware (month filtering)

### 2. `get_dashboard_intents()`
- **Status**: ❌ NOT EXISTS
- **Contract**:
  ```sql
  get_dashboard_intents(
    p_site_id uuid,
    p_date_from timestamptz,
    p_date_to timestamptz,
    p_status text DEFAULT NULL, -- 'pending' | 'sealed' | 'junk' | 'suspicious' | NULL
    p_search text DEFAULT NULL
  )
  ```
- **Returns**: `jsonb[]` with intent rows
- **Requirements**:
  - ✅ Filter by `site_id`
  - ✅ Filter by `date_from/date_to`
  - ✅ Max 6 months range validation
  - ✅ Status filtering
  - ✅ Search by page_url
  - ✅ Combine calls + conversion events

### 3. `get_dashboard_breakdown()` (Phase 4)
- **Status**: ❌ NOT EXISTS
- **Contract**:
  ```sql
  get_dashboard_breakdown(
    p_site_id uuid,
    p_date_from timestamptz,
    p_date_to timestamptz,
    p_dimension text -- 'source' | 'device' | 'city'
  )
  ```
- **Returns**: `jsonb[]` with `{ dimension_value, count, percentage }`
- **Requirements**:
  - ✅ Filter by `site_id`
  - ✅ Filter by `date_from/date_to`
  - ✅ Max 6 months range validation
  - ✅ Exclude heartbeat events
  - ✅ Aggregate by dimension (source/device/city)

---

## MISSING UI COMPONENTS (Phase 4)

### BreakdownWidget
- **Status**: ❌ NOT EXISTS
- **Location**: Should be `components/dashboard/breakdown-widget.tsx`
- **Requirements**:
  - Display sources breakdown
  - Display devices breakdown
  - Display cities breakdown
  - Use `get_dashboard_breakdown()` RPC
  - Integrate into DashboardLayout

---

## MIGRATION REQUIRED

### `get_dashboard_stats()` Migration
- **Current**: `get_dashboard_stats(p_site_id uuid, p_days int)`
- **Target**: `get_dashboard_stats(p_site_id uuid, p_date_from timestamptz, p_date_to timestamptz)`
- **Breaking**: Yes (signature change)
- **Action**: Create new migration with updated function + update hook

---

## COMPLIANCE CHECK

### Hard Rules Compliance

| Rule | Status | Notes |
|------|--------|-------|
| No cross-site leakage | ✅ | All queries use site_id filter |
| date_from/date_to required | ❌ | `get_dashboard_stats` uses `p_days` |
| Max 6 months range | ❌ | No validation in RPCs |
| Heartbeat exclusion | ⚠️ | Not explicitly excluded in all queries |
| No client-side aggregation | ❌ | `useTimelineData` and `useIntents` violate |
| Realtime not redraw chart | ✅ | Phase 5 bounded refresh implemented |

---

## ACTION ITEMS

### Phase 1: RPC Contract Set
1. ✅ Audit complete (this document)
2. ⏳ Migrate `get_dashboard_stats` to `date_from/date_to`
3. ⏳ Create `get_dashboard_timeline()` RPC
4. ⏳ Create `get_dashboard_intents()` RPC
5. ⏳ Update hooks to use new RPCs
6. ⏳ Remove client-side aggregation

### Phase 4: Breakdown Widget
1. ⏳ Create `get_dashboard_breakdown()` RPC
2. ⏳ Create `BreakdownWidget` component
3. ⏳ Integrate into DashboardLayout
4. ⏳ Create hook `useBreakdownData()`

---

## FILES TO TOUCH

### Migrations
- `supabase/migrations/20260128020000_rpc_contract_v2_2.sql` (NEW)
  - Migrate `get_dashboard_stats` to `date_from/date_to`
  - Create `get_dashboard_timeline()`
  - Create `get_dashboard_intents()`
  - Create `get_dashboard_breakdown()`
  - Add 6-month range validation helper

### Hooks
- `lib/hooks/use-dashboard-stats.ts` (MODIFY)
  - Update to use `date_from/date_to` instead of `days`
- `lib/hooks/use-timeline-data.ts` (MODIFY)
  - Replace client-side aggregation with RPC call
- `lib/hooks/use-intents.ts` (MODIFY)
  - Replace client-side queries with RPC call
- `lib/hooks/use-breakdown-data.ts` (NEW)
  - New hook for breakdown widget

### Components
- `components/dashboard/breakdown-widget.tsx` (NEW)
  - Breakdown widget component
- `components/dashboard/dashboard-layout.tsx` (MODIFY)
  - Add BreakdownWidget to layout

---

**Status**: ✅ Audit Complete - Ready for Implementation

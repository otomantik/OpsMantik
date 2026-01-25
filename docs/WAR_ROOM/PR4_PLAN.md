# PR4 Plan - UI Data Boundary Cleanup

**Date:** 2026-01-25  
**PR Title:** `refactor: extract data fetching from components, remove redundancy`  
**Status:** 📋 PLAN ONLY (Not implemented)

---

## GOAL

Extract data fetching/transformation logic from UI components into reusable hooks, reducing component complexity and improving maintainability.

**Target:** Reduce `live-feed.tsx` from 533 lines to ~300 lines (40% reduction)

---

## TARGET FILES (FROM HOTSPOTS)

### Primary Targets
1. **`components/dashboard/live-feed.tsx`** (533 lines) - HIGH priority
   - Extract: Data fetching, realtime subscriptions, event grouping
   - Keep: UI rendering, filter UI, display logic

2. **`components/dashboard/call-alert-wrapper.tsx`** (314 lines) - MEDIUM priority
   - Extract: Call fetching, realtime subscriptions
   - Keep: UI rendering, dismissal logic

3. **`components/dashboard/session-group.tsx`** (451 lines) - MEDIUM priority
   - Extract: Session data fetching, call matching
   - Keep: UI rendering, context chips, attribution display

### Secondary Targets
4. **`app/dashboard/site/[siteId]/page.tsx`** (155 lines) - LOW priority
   - Remove: Redundant access check (trust RLS)

---

## EXTRACTION PLAN

### Hook 1: `useLiveFeedData(siteId?: string)`

**Purpose:** Fetch and manage Live Feed data (events, sessions, realtime)

**Extract From:** `components/dashboard/live-feed.tsx`

**Responsibilities:**
- Initial data fetch (sessions + events)
- Realtime subscription setup/cleanup
- Event grouping (PR3 incremental grouping preserved)
- Filter extraction (cities/districts/devices from sessions)
- State management: `events`, `groupedSessions`, `userSites`, `isInitialized`

**Returns:**
```typescript
{
  events: Event[];
  groupedSessions: Record<string, Event[]>;
  userSites: string[];
  isInitialized: boolean;
  isLoading: boolean;
  error: Error | null;
}
```

**Preserve:**
- ✅ PR1 deterministic ordering (id DESC tie-breaker)
- ✅ PR3 incremental grouping (update only affected session)
- ✅ Realtime subscription hygiene (no redundant queries)
- ✅ Month partition filtering
- ✅ RLS compliance (JOIN patterns)

**Files:**
- **New:** `lib/hooks/use-live-feed-data.ts`
- **Modified:** `components/dashboard/live-feed.tsx` (use hook, remove fetch logic)

---

### Hook 2: `useCallMonitorData(siteId?: string)`

**Purpose:** Fetch and manage Call Monitor data (calls, realtime)

**Extract From:** `components/dashboard/call-alert-wrapper.tsx`

**Responsibilities:**
- Initial call fetch
- Realtime subscription setup/cleanup
- Call state management: `calls`, `dismissed`, `newMatchIds`
- Site filtering (client-side check, RLS already enforced)

**Returns:**
```typescript
{
  calls: Call[];
  dismissed: Set<string>;
  newMatchIds: Set<string>;
  isLoading: boolean;
  error: Error | null;
  onDismiss: (id: string) => void;
}
```

**Preserve:**
- ✅ PR1 deterministic ordering (id DESC tie-breaker)
- ✅ Realtime subscription hygiene (no redundant queries)
- ✅ RLS compliance (trust subscription filter)

**Files:**
- **New:** `lib/hooks/use-call-monitor-data.ts`
- **Modified:** `components/dashboard/call-alert-wrapper.tsx` (use hook, remove fetch logic)

---

### Hook 3: `useSessionData(sessionId: string)`

**Purpose:** Fetch session data and matched call

**Extract From:** `components/dashboard/session-group.tsx`

**Responsibilities:**
- Session data fetch (attribution_source, device_type, city, district, fingerprint, gclid)
- Call matching (fingerprint lookup)
- State management: `sessionData`, `matchedCall`, `isLoadingCall`

**Returns:**
```typescript
{
  sessionData: {
    attribution_source: string | null;
    device_type: string | null;
    city: string | null;
    district: string | null;
    fingerprint: string | null;
    gclid: string | null;
  } | null;
  matchedCall: Call | null;
  isLoading: boolean;
  error: Error | null;
}
```

**Preserve:**
- ✅ Attribution fallback (session → metadata)
- ✅ Context chips fallback (session → metadata)
- ✅ Call matching logic (fingerprint lookup)

**Files:**
- **New:** `lib/hooks/use-session-data.ts`
- **Modified:** `components/dashboard/session-group.tsx` (use hook, remove fetch logic)

---

### Utility: `normalizeEvent(rawEvent: any): Event`

**Purpose:** Normalize event data from Supabase JOIN structure

**Extract From:** `components/dashboard/live-feed.tsx:168-179`

**Responsibilities:**
- Extract nested JOIN structure to flat Event interface
- Handle Supabase JOIN response format

**Returns:**
```typescript
Event {
  id: string;
  session_id: string;
  session_month: string;
  event_category: string;
  event_action: string;
  event_label: string | null;
  event_value: number | null;
  metadata: any;
  created_at: string;
  url?: string;
}
```

**Files:**
- **New:** `lib/events.ts` (normalizeEvent function)
- **Modified:** `components/dashboard/live-feed.tsx` (use utility)

---

## KEEP BEHAVIORS

### PR1 Deterministic Ordering
- ✅ All queries maintain `id DESC` tie-breaker
- ✅ Client-side sorts maintain tie-breaker
- ✅ No regression in sorting stability

### PR3 Incremental Grouping
- ✅ Incremental session group updates (not full regroup)
- ✅ No redundant RLS verification queries
- ✅ Memoized grouping via useEffect

### PR2 Canonical Modules
- ✅ Geo extraction uses `lib/geo.ts`
- ✅ Lead scoring uses `lib/scoring.ts`
- ✅ Attribution uses `lib/attribution.ts`

### RLS/Site Scope
- ✅ All queries use RLS-compliant patterns
- ✅ JOIN patterns for RLS enforcement
- ✅ No client-side security assumptions

---

## IMPLEMENTATION STEPS

### Step 1: Create Hooks Directory
- [ ] Create `lib/hooks/` directory
- [ ] Add TypeScript interfaces for hook returns

### Step 2: Extract `useLiveFeedData`
- [ ] Create `lib/hooks/use-live-feed-data.ts`
- [ ] Move data fetching logic from `live-feed.tsx:71-193`
- [ ] Move realtime subscription from `live-feed.tsx:195-340`
- [ ] Move event grouping from `live-feed.tsx:51-80`
- [ ] Move filter extraction from `live-feed.tsx:346-366`
- [ ] Update `live-feed.tsx` to use hook

### Step 3: Extract `useCallMonitorData`
- [ ] Create `lib/hooks/use-call-monitor-data.ts`
- [ ] Move call fetching from `call-alert-wrapper.tsx:40-111`
- [ ] Move realtime subscription from `call-alert-wrapper.tsx:113-260`
- [ ] Update `call-alert-wrapper.tsx` to use hook

### Step 4: Extract `useSessionData`
- [ ] Create `lib/hooks/use-session-data.ts`
- [ ] Move session fetch from `session-group.tsx:44-59`
- [ ] Move call matching from `session-group.tsx:62-104`
- [ ] Update `session-group.tsx` to use hook

### Step 5: Extract `normalizeEvent`
- [ ] Create `lib/events.ts`
- [ ] Move normalization logic from `live-feed.tsx:168-179`
- [ ] Update `live-feed.tsx` to use utility

### Step 6: Remove Redundant Access Check
- [ ] Update `app/dashboard/site/[siteId]/page.tsx:49-72`
- [ ] Remove duplicate access check (trust RLS)

### Step 7: Acceptance Checks
- [ ] Run `npx tsc --noEmit`
- [ ] Run `npm run build`
- [ ] Run `npm run check:warroom`
- [ ] Run `npm run check:attribution`
- [ ] Smoke test: Verify Live Feed works
- [ ] Smoke test: Verify Call Monitor works
- [ ] Smoke test: Verify Session Group works

---

## ACCEPTANCE CRITERIA

### Code Quality
- ✅ `npx tsc --noEmit` passes
- ✅ `npm run build` passes
- ✅ `npm run check:warroom` passes
- ✅ `npm run check:attribution` passes

### Functionality
- ✅ Live Feed displays events in stable order (PR1)
- ✅ Realtime updates work without render storms (PR3)
- ✅ Call Monitor displays calls correctly
- ✅ Session Group shows attribution and context chips
- ✅ No console errors

### Code Reduction
- ✅ `live-feed.tsx` reduced by ~40% (533 → ~300 lines)
- ✅ `call-alert-wrapper.tsx` reduced by ~30% (314 → ~220 lines)
- ✅ `session-group.tsx` reduced by ~20% (451 → ~360 lines)

### Behavior Preservation
- ✅ PR1 deterministic ordering intact
- ✅ PR3 incremental grouping intact
- ✅ PR2 canonical modules intact
- ✅ RLS/site scope invariants preserved

---

## ROLLBACK PLAN

**If PR4 Fails:**
1. Identify failing acceptance gate
2. Revert commit: `git revert <commit-hash>`
3. Document failure reason
4. Re-assess extraction boundaries

**No Data Impact:**
- All changes are code-only (no migrations)
- Revert is safe
- No database schema changes

---

## RISK ASSESSMENT

**Risk Level:** MEDIUM
- **Reason:** Significant refactor, multiple files touched
- **Impact:** Code organization improved, functionality unchanged
- **Mitigation:** 
  - Preserve all existing behaviors
  - Maintain PR1/PR2/PR3 invariants
  - Extensive testing before merge

**Dependencies:**
- PR1: Deterministic sorting (must preserve)
- PR2: Canonical modules (must preserve)
- PR3: Realtime hygiene (must preserve)

---

## FILES TO TOUCH

### New Files (4)
1. `lib/hooks/use-live-feed-data.ts` - Live Feed data hook
2. `lib/hooks/use-call-monitor-data.ts` - Call Monitor data hook
3. `lib/hooks/use-session-data.ts` - Session data hook
4. `lib/events.ts` - Event normalization utility

### Modified Files (4)
5. `components/dashboard/live-feed.tsx` - Use hooks, remove fetch logic
6. `components/dashboard/call-alert-wrapper.tsx` - Use hook, remove fetch logic
7. `components/dashboard/session-group.tsx` - Use hook, remove fetch logic
8. `app/dashboard/site/[siteId]/page.tsx` - Remove redundant access check

---

## EXTRACTION BOUNDARIES

### What to Extract
- ✅ Data fetching (Supabase queries)
- ✅ Realtime subscription setup/cleanup
- ✅ Data transformation (grouping, normalization)
- ✅ State management (events, calls, sessions)

### What to Keep in Components
- ✅ UI rendering (JSX)
- ✅ User interactions (button clicks, filter changes)
- ✅ Visual state (expanded, selected filters)
- ✅ Event handlers (onDismiss, onFilterChange)

---

## PRESERVATION CHECKLIST

### PR1: Deterministic Ordering
- [ ] All queries have `id DESC` tie-breaker
- [ ] Client-side sorts have tie-breaker
- [ ] No regression in sorting stability

### PR3: Realtime Hygiene
- [ ] Incremental grouping preserved
- [ ] No redundant RLS queries
- [ ] Memoized grouping via useEffect

### PR2: Canonical Modules
- [ ] Geo extraction uses `lib/geo.ts`
- [ ] Lead scoring uses `lib/scoring.ts`
- [ ] Attribution uses `lib/attribution.ts`

### RLS/Site Scope
- [ ] All queries use RLS-compliant patterns
- [ ] JOIN patterns for RLS enforcement
- [ ] No client-side security assumptions

---

## ESTIMATED IMPACT

**Code Reduction:**
- `live-feed.tsx`: 533 → ~300 lines (-233 lines, -44%)
- `call-alert-wrapper.tsx`: 314 → ~220 lines (-94 lines, -30%)
- `session-group.tsx`: 451 → ~360 lines (-91 lines, -20%)

**New Code:**
- `use-live-feed-data.ts`: ~200 lines
- `use-call-monitor-data.ts`: ~150 lines
- `use-session-data.ts`: ~100 lines
- `events.ts`: ~30 lines

**Net Change:** ~-200 lines (code moved, not deleted)

---

## NEXT STEPS (AFTER PR4)

**Potential Follow-ups:**
- PR5: Additional guardrails (if needed)
- PR6: Mobile hardening (already complete)
- Future: Server-side filtering (move filters to RPC)

---

**PR4 Status:** 📋 PLAN READY - Not implemented

**Last Updated:** 2026-01-25

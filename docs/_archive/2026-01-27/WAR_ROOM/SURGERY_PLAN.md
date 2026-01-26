# SURGERY PLAN - Minimal Diff Refactoring PRs

**Date:** 2026-01-25  
**Purpose:** Staged PR plan for surgical refactoring

---

## PR STRATEGY

**Rules:**
- Each PR mergeable alone
- Minimal diffs (move/delete > add)
- Acceptance gates: `check:warroom`, `check:attribution`, `npm run build`, `npx tsc --noEmit`
- Rollback plan: Git revert if issues

---

## PR1: Canonical Sorting & Time Semantics

**Title:** `fix: add deterministic sorting with tie-breaker (id DESC)`

**Scope:**
- Add `id DESC` as secondary sort to all queries
- Fix non-deterministic order issues

**Files Touched:**
- `components/dashboard/live-feed.tsx` (lines 141, 160)
- `components/dashboard/call-alert-wrapper.tsx` (lines 74, 98)
- `components/dashboard/session-group.tsx` (line 139)
- `components/dashboard/tracked-events-panel.tsx` (line 84)

**Changes:**
```typescript
// Before
.order('created_at', { ascending: false })

// After
.order('created_at', { ascending: false })
.order('id', { ascending: false })
```

**Acceptance Criteria:**
- ✅ `npx tsc --noEmit` passes
- ✅ `npm run build` passes
- ✅ `check:warroom` passes
- ✅ `check:attribution` passes
- ✅ Realtime updates maintain stable order (no UI jump)
- ✅ Same timestamp events/calls have consistent order

**Risk:** Low (additive only, no logic changes)

**Rollback:** Revert commit, no data impact

---

## PR2: Single Source of Truth Modules

**Title:** `refactor: extract attribution, geo, scoring to canonical modules`

**Scope:**
- Extract geo extraction to `lib/geo.ts`
- Extract lead scoring to `lib/scoring.ts`
- Fix attribution fallback redundancy
- Fix Live Feed filter to use session fields

**Files Touched:**
- **New:** `lib/geo.ts` (extract from `/api/sync`)
- **New:** `lib/scoring.ts` (extract from `/api/sync`)
- `app/api/sync/route.ts` (use new modules)
- `components/dashboard/live-feed.tsx` (filter on session fields)
- `components/dashboard/session-group.tsx` (remove redundant fallback)

**Changes:**
```typescript
// lib/geo.ts
export function extractGeoInfo(req: NextRequest, meta?: any): GeoInfo

// lib/scoring.ts
export function computeLeadScore(event: EventInput, referrer: string, isReturningAdUser: boolean): number

// live-feed.tsx - filter on session data
const sessionData = await fetchSessionData(sessionId);
const city = sessionData?.city || metadata.city;
```

**Acceptance Criteria:**
- ✅ `npx tsc --noEmit` passes
- ✅ `npm run build` passes
- ✅ `check:warroom` passes
- ✅ `check:attribution` passes
- ✅ Attribution logic unchanged (same results)
- ✅ Geo extraction unchanged (same results)
- ✅ Lead scoring unchanged (same results)

**Risk:** Low (extraction only, no logic changes)

**Rollback:** Revert commit, restore inline logic

---

## PR3: Realtime Subscription Hygiene

**Title:** `refactor: stabilize realtime subscriptions, reduce render storms`

**Scope:**
- Extract subscription utility: `useRealtimeSubscription()`
- Debounce event grouping in Live Feed
- Remove redundant RLS verification queries (trust subscription filter)
- Switch TrackedEventsPanel to realtime

**Files Touched:**
- **New:** `lib/hooks/use-realtime-subscription.ts`
- `components/dashboard/live-feed.tsx` (use hook, debounce grouping)
- `components/dashboard/call-alert-wrapper.tsx` (use hook, remove verification)
- `components/dashboard/tracked-events-panel.tsx` (switch to realtime)

**Changes:**
```typescript
// lib/hooks/use-realtime-subscription.ts
export function useRealtimeSubscription<T>(
  channel: string,
  table: string,
  handler: (payload: T) => void,
  deps: any[]
): void

// live-feed.tsx - debounce grouping
const debouncedGroup = useMemo(() => 
  debounce(groupEventsBySession, 100), 
  [groupEventsBySession]
);
```

**Acceptance Criteria:**
- ✅ `npx tsc --noEmit` passes
- ✅ `npm run build` passes
- ✅ `check:warroom` passes
- ✅ No duplicate subscriptions (console check)
- ✅ Reduced render count (React DevTools)
- ✅ Realtime still works (smoke test)

**Risk:** Medium (realtime logic changes)

**Rollback:** Revert commit, restore old subscription pattern

---

## PR4: UI Data Boundary Cleanup

**Title:** `refactor: extract data fetching from components, remove redundancy`

**Scope:**
- Extract `useLiveFeed(siteId)` hook
- Extract `useCallMonitor(siteId)` hook
- Extract `useSessionData(sessionId)` hook
- Extract `normalizeEvent()` utility
- Remove redundant access checks (trust RLS)
- Remove redundant subscription detection code

**Files Touched:**
- **New:** `lib/hooks/use-live-feed.ts`
- **New:** `lib/hooks/use-call-monitor.ts`
- **New:** `lib/hooks/use-session-data.ts`
- **New:** `lib/events.ts` (normalizeEvent)
- `components/dashboard/live-feed.tsx` (use hook, remove fetch logic)
- `components/dashboard/call-alert-wrapper.tsx` (use hook)
- `components/dashboard/session-group.tsx` (use hook)
- `app/dashboard/site/[siteId]/page.tsx` (remove redundant access check)

**Changes:**
```typescript
// lib/hooks/use-live-feed.ts
export function useLiveFeed(siteId?: string): {
  events: Event[];
  groupedSessions: Record<string, Event[]>;
  isLoading: boolean;
  error: Error | null;
}

// Components become thin wrappers
export function LiveFeed({ siteId }: LiveFeedProps) {
  const { events, groupedSessions, isLoading } = useLiveFeed(siteId);
  // Render only
}
```

**Acceptance Criteria:**
- ✅ `npx tsc --noEmit` passes
- ✅ `npm run build` passes
- ✅ `check:warroom` passes
- ✅ `check:attribution` passes
- ✅ Functionality unchanged (smoke test)
- ✅ Component files reduced by ~40% (data logic moved)

**Risk:** Medium (significant refactor)

**Rollback:** Revert commit, restore inline logic

---

## PR5: Guardrails & Idempotency

**Title:** `fix: add idempotency guards for Confirm/Junk actions`

**Scope:**
- Add optimistic lock for Confirm action
- Add status check before update

**Files Touched:**
- `components/dashboard/call-alert.tsx` (handleConfirm, handleJunk)

**Changes:**
```typescript
const handleConfirm = async () => {
  // Check current status before update
  const { data: current } = await supabase
    .from('calls')
    .select('status')
    .eq('id', call.id)
    .single();
  
  if (current?.status === 'confirmed') {
    // Already confirmed, skip
    return;
  }
  
  // Proceed with update
  // ...
};
```

**Acceptance Criteria:**
- ✅ `npx tsc --noEmit` passes
- ✅ `npm run build` passes
- ✅ `check:warroom` passes
- ✅ Double-click Confirm doesn't cause errors
- ✅ Status updates correctly

**Risk:** Low (additive guard only)

**Rollback:** Revert commit, remove guard

---

## PR6: Mobile Hardening Pass

**Title:** `fix: mobile responsive improvements (CSS/layout only)`

**Scope:**
- Fix Call Monitor positioning on mobile
- Increase tap targets
- Add sticky filter bar
- Fix context chips wrapping
- Fix horizontal overflow

**Files Touched:**
- `app/dashboard/site/[siteId]/page.tsx` (responsive padding)
- `components/dashboard/call-alert.tsx` (button sizes, layout)
- `components/dashboard/live-feed.tsx` (sticky header, filter bar)
- `components/dashboard/session-group.tsx` (chip wrapping)

**Changes:**
```typescript
// CSS-only changes, no logic
className="hidden lg:block fixed top-6 right-6 z-50 w-full lg:w-72"
className="h-10 w-10 lg:h-7 lg:w-7" // Larger on mobile
className="sticky top-0 z-10 bg-slate-900" // Sticky filter
```

**Acceptance Criteria:**
- ✅ `npx tsc --noEmit` passes
- ✅ `npm run build` passes
- ✅ `check:warroom` passes
- ✅ Tested on 390px viewport (Chrome DevTools)
- ✅ No horizontal overflow
- ✅ All buttons tappable (44px+)
- ✅ Filter bar sticky on scroll

**Risk:** Low (CSS only, no logic)

**Rollback:** Revert commit, restore old classes

---

## PR EXECUTION ORDER

**Recommended Sequence:**
1. **PR1** (Sorting) - Lowest risk, immediate benefit
2. **PR2** (Modules) - Foundation for other PRs
3. **PR5** (Guardrails) - Quick win, low risk
4. **PR3** (Realtime) - Performance improvement
5. **PR4** (Data Boundary) - Major cleanup (depends on PR2)
6. **PR6** (Mobile) - Independent, can be parallel

**Parallel Execution:**
- PR1 + PR5 (independent)
- PR6 (independent, CSS only)

**Dependencies:**
- PR4 depends on PR2 (needs extracted modules)

---

## ACCEPTANCE GATES (All PRs)

**Mandatory:**
- ✅ `npx tsc --noEmit` - No TypeScript errors
- ✅ `npm run build` - Build succeeds
- ✅ `npm run check:warroom` - No service role leaks
- ✅ `npm run check:attribution` - Attribution logic intact

**Smoke Tests:**
- ✅ Live Feed shows events in stable order
- ✅ Call Monitor shows intents/confirmed calls
- ✅ Realtime updates work (no duplicates)
- ✅ Mobile viewport (390px) - no overflow, tappable buttons

---

## ROLLBACK PLAN

**If PR Fails:**
1. Identify failing acceptance gate
2. Revert commit: `git revert <commit-hash>`
3. Document failure reason
4. Re-assess fix strategy

**No Data Impact:**
- All PRs are code-only (no migrations)
- Revert is safe

---

**Last Updated:** 2026-01-25

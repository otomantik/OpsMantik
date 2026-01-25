# PR4 Start - UI Data Boundary Cleanup

**Date:** 2026-01-25  
**Branch:** `pr4-data-boundary-cleanup`  
**Status:** 🚀 READY TO START

---

## BRANCH INFORMATION

**Branch Name:** `pr4-data-boundary-cleanup`  
**Base Branch:** `master` (latest default branch)  
**Purpose:** Extract data fetching logic from UI components into reusable hooks

---

## SCOPE LOCK CONFIRMATION

**Scope Lock Document:** `docs/WAR_ROOM/PR4_SCOPE_LOCK.md`  
**Status:** ✅ TREATED AS IMMUTABLE LAW

All extraction boundaries, hook signatures, and behavior preservation requirements are locked and will be followed exactly.

---

## FILES TO TOUCH (IMMUTABLE LIST)

### New Files (4) - TO CREATE

1. **`lib/hooks/use-live-feed-data.ts`**
   - Extract: Event grouping, initial data fetch, realtime subscription from `live-feed.tsx`
   - Signature: `useLiveFeedData(siteId?: string): UseLiveFeedDataResult`
   - Preserves: PR1 deterministic ordering, PR3 incremental grouping, RLS compliance

2. **`lib/hooks/use-call-monitor-data.ts`**
   - Extract: Call fetching, realtime subscription from `call-alert-wrapper.tsx`
   - Signature: `useCallMonitorData(siteId?: string): UseCallMonitorDataResult`
   - Preserves: PR1 deterministic ordering, PR3 no redundant queries, RLS compliance

3. **`lib/hooks/use-session-data.ts`**
   - Extract: Session data fetch, call matching from `session-group.tsx`
   - Signature: `useSessionData(sessionId: string, metadata?: any): UseSessionDataResult`
   - Preserves: PR1 deterministic ordering, attribution fallback, RLS compliance

4. **`lib/events.ts`**
   - Extract: Event normalization utility from `live-feed.tsx`
   - Signature: `normalizeEvent(item: any): Event`
   - Purpose: Normalize Supabase JOIN response structure

### Modified Files (4) - TO UPDATE

5. **`components/dashboard/live-feed.tsx`**
   - Remove: Event grouping logic (lines 51-78), initial data fetch (lines 80-202), realtime subscription (lines 204-344)
   - Keep: Filter state, filter UI, error/loading states, main render
   - Add: `useLiveFeedData` hook import and usage
   - Target: ~200 lines (down from 540, -63%)

6. **`components/dashboard/call-alert-wrapper.tsx`**
   - Remove: Call fetching (lines 48-111), realtime subscription (lines 113-253)
   - Keep: Dismissed filter, error/loading states, main render
   - Add: `useCallMonitorData` hook import and usage
   - Target: ~80 lines (down from 302, -73%)

7. **`components/dashboard/session-group.tsx`**
   - Remove: Session data fetch (lines 44-59), call matching (lines 76-105)
   - Keep: UI state, event processing, attribution/context derivation, UI helpers, full JSX render
   - Add: `useSessionData` hook import and usage
   - Target: ~400 lines (down from 458, -13%)

8. **`app/dashboard/site/[siteId]/page.tsx`**
   - Remove: Redundant access check (lines 48-72)
   - Keep: User auth, admin check, RLS-based site fetch, all JSX
   - Change: Trust RLS for access enforcement (remove duplicate check)
   - Target: ~137 lines (down from 160)

### Updated Files (1) - TO UPDATE

9. **`scripts/check-attribution.js`**
   - Update: Add check for `lib/hooks/use-session-data.ts` (hook now fetches session data)
   - Keep: All existing attribution regression checks
   - Purpose: Ensure attribution check passes after extraction

---

## TOTAL FILES: 9

- **4 new files** (hooks + utility)
- **4 modified files** (components + page)
- **1 updated file** (check script)

---

## EXTRACTION BOUNDARIES (FROM SCOPE LOCK)

### `live-feed.tsx` Extraction:
- ✅ Event grouping logic (original lines 51-78)
- ✅ Initial data fetch (original lines 80-202)
- ✅ Realtime subscription (original lines 204-344)
- ✅ Event normalization (original lines 179-190) → `lib/events.ts`

### `call-alert-wrapper.tsx` Extraction:
- ✅ Initial call fetch (original lines 48-111)
- ✅ Realtime subscription (original lines 113-253)
- ✅ Dismiss handler (original lines 255-257)

### `session-group.tsx` Extraction:
- ✅ Session data fetch (original lines 44-59)
- ✅ Call matching (original lines 76-105)

### `app/dashboard/site/[siteId]/page.tsx` Removal:
- ✅ Redundant access check (original lines 48-72)

---

## BEHAVIOR PRESERVATION (IMMUTABLE)

### PR1: Deterministic Ordering ✅
- All queries: `.order('id', { ascending: false })` tie-breaker
- All sorts: `id.localeCompare(b.id)` tie-breaker
- **Status:** VERBATIM PRESERVATION REQUIRED

### PR2: Canonical Modules ✅
- Geo: `lib/geo.ts` (unchanged)
- Scoring: `lib/scoring.ts` (unchanged)
- Attribution: `lib/attribution.ts` (unchanged)
- **Status:** NO CHANGES ALLOWED

### PR3: Realtime Hygiene ✅
- Incremental grouping: Update only affected session
- No redundant RLS queries: Trust subscription filter
- Memoized grouping: `useEffect` with `[events]` dependency
- **Status:** VERBATIM PRESERVATION REQUIRED

### RLS/Site Scope ✅
- All queries: RLS-compliant JOIN patterns
- No client-side security assumptions
- **Status:** VERBATIM PRESERVATION REQUIRED

---

## ACCEPTANCE GATES (MUST PASS)

### Code Quality
- [ ] `npx tsc --noEmit` - Must pass
- [ ] `npm run build` - Must pass
- [ ] `npm run check:warroom` - Must pass
- [ ] `npm run check:attribution` - Must pass

### Functionality
- [ ] Live Feed displays events in stable order (PR1)
- [ ] Realtime updates work without render storms (PR3)
- [ ] Call Monitor displays calls correctly
- [ ] Session Group shows attribution and context chips
- [ ] No console errors

### Code Reduction
- [ ] `live-feed.tsx` reduced by ~63% (540 → ~200 lines)
- [ ] `call-alert-wrapper.tsx` reduced by ~73% (302 → ~80 lines)
- [ ] `session-group.tsx` reduced by ~13% (458 → ~400 lines)

---

## IMPLEMENTATION ORDER

1. **Create hooks directory:** `lib/hooks/`
2. **Create utility:** `lib/events.ts` (normalizeEvent)
3. **Create hook 1:** `lib/hooks/use-live-feed-data.ts`
4. **Create hook 2:** `lib/hooks/use-call-monitor-data.ts`
5. **Create hook 3:** `lib/hooks/use-session-data.ts`
6. **Update component 1:** `components/dashboard/live-feed.tsx`
7. **Update component 2:** `components/dashboard/call-alert-wrapper.tsx`
8. **Update component 3:** `components/dashboard/session-group.tsx`
9. **Update page:** `app/dashboard/site/[siteId]/page.tsx`
10. **Update check script:** `scripts/check-attribution.js`
11. **Run acceptance gates:** All checks must pass

---

## RISK MITIGATION

**No Breaking Changes:**
- Component interfaces unchanged
- Props unchanged
- Behavior unchanged
- Only code organization changed

**Preserved Invariants:**
- PR1: All deterministic ordering logic verbatim
- PR2: All canonical modules untouched
- PR3: All realtime hygiene patterns verbatim
- RLS: All security patterns preserved

---

## COMMIT STRATEGY

**Single Commit:**
- All changes in one commit
- Message: `refactor: extract data fetching from components into hooks (PR4)`
- Description: List all files changed and behavior preservation confirmations

---

## STATUS

**Branch:** `pr4-data-boundary-cleanup` ✅ CREATED  
**Scope Lock:** ✅ CONFIRMED AS IMMUTABLE LAW  
**File List:** ✅ LOCKED (9 files total)  
**Behavior Preservation:** ✅ CONFIRMED  
**Ready to Start:** ✅ YES

---

**Next Step:** Begin implementation following exact boundaries in `PR4_SCOPE_LOCK.md`

**Last Updated:** 2026-01-25

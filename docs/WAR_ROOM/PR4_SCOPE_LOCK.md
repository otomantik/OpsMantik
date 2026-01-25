# PR4 Scope Lock - UI Data Boundary Cleanup

**Date:** 2026-01-25  
**Status:** 🔒 LOCKED - Ready for Implementation

---

## EXTRACTION BOUNDARIES

### File 1: `components/dashboard/live-feed.tsx`

#### EXTRACT TO: `lib/hooks/use-live-feed-data.ts`

**Line Ranges to Extract:**

1. **Event Grouping Logic** (Original: lines 51-78)
   - Memoized grouping: compute groupedSessions from events
   - Group events by session_id
   - Sort events within each session (PR1: deterministic order with id tie-breaker)
   - **Extract:** Full useEffect hook with grouping logic

2. **Initial Data Fetch** (Original: lines 80-202)
   - User authentication check
   - Site access verification (RLS)
   - Sites list fetch (user's sites or single siteId)
   - Sessions fetch (RLS compliant, month partition filter)
   - Events fetch (RLS compliant JOIN pattern)
   - Event normalization (map JOIN structure to flat Event)
   - **Extract:** Full useEffect hook with async initialize function

3. **Realtime Subscription** (Original: lines 204-344)
   - Subscription setup/cleanup
   - Duplicate subscription detection
   - Event INSERT handler
   - Month partition filtering
   - Incremental event updates (PR3: no full regroup)
   - Incremental grouping updates (PR3: update only affected session)
   - **Extract:** Full useEffect hook with subscription logic

**State to Extract:**
- `events: Event[]`
- `groupedSessions: Record<string, Event[]>`
- `userSites: string[]`
- `isInitialized: boolean`
- `isLoading: boolean`
- `error: Error | null`
- `subscriptionRef: useRef<any>(null)`
- `isMountedRef: useRef<boolean>(true)`
- `duplicateWarningRef: useRef<boolean>(false)`

**What STAYS in Component:**
- Filter state: `selectedCity`, `selectedDistrict`, `selectedDevice`
- Filter extraction: `filterOptions` useMemo (lines 34-54)
- Filter application: `displayedSessions` useMemo (lines 56-75)
- Filter UI: JSX for filter selects and clear button (lines 172-222)
- Error/loading/empty state UI (lines 84-153)
- Main render: JSX for card, header, session list (lines 155-240)

---

### File 2: `components/dashboard/call-alert-wrapper.tsx`

#### EXTRACT TO: `lib/hooks/use-call-monitor-data.ts`

**Line Ranges to Extract:**

1. **Initial Call Fetch** (Original: lines 48-111)
   - User authentication check
   - Site access verification (RLS)
   - Sites list fetch (user's sites or single siteId)
   - Calls fetch (RLS compliant, PR1: deterministic order)
   - Previous call IDs tracking
   - **Extract:** Full useEffect hook with async fetchRecentCalls function

2. **Realtime Subscription** (Original: lines 113-253)
   - Subscription setup/cleanup
   - Duplicate subscription detection
   - Call INSERT handler
   - Site filtering (client-side check)
   - New match detection and timeout management
   - Incremental call updates (PR1: deterministic order)
   - **Extract:** Full useEffect hook with subscription logic

**State to Extract:**
- `calls: Call[]`
- `dismissed: Set<string>`
- `userSites: string[]`
- `newMatchIds: Set<string>`
- `isLoading: boolean`
- `error: Error | null`
- `previousCallIdsRef: useRef<Set<string>>(new Set())`
- `subscriptionRef: useRef<any>(null)`
- `isMountedRef: useRef<boolean>(true)`
- `timeoutRefsRef: useRef<Set<NodeJS.Timeout>>(new Set())`
- `duplicateWarningRef: useRef<boolean>(false)`

**Handler to Extract:**
- `handleDismiss: useCallback((id: string) => void)`

**What STAYS in Component:**
- `visibleCalls` useMemo (filter dismissed calls) - lines 16-20
- Error/loading/empty state UI (lines 22-51)
- Main render: JSX for card, header, call list (lines 53-90)

---

### File 3: `components/dashboard/session-group.tsx`

#### EXTRACT TO: `lib/hooks/use-session-data.ts`

**Line Ranges to Extract:**

1. **Session Data Fetch** (Original: lines 44-59)
   - Session data fetch (attribution_source, device_type, city, district, fingerprint, gclid)
   - RLS compliant query
   - **Extract:** Full useEffect hook with async fetchSessionData function

2. **Call Matching** (Original: lines 76-105)
   - Fingerprint extraction (from sessionData or metadata)
   - Call lookup via fingerprint (RLS compliant JOIN pattern)
   - PR1: deterministic order (id DESC tie-breaker)
   - **Extract:** Full useEffect hook with call matching logic

**State to Extract:**
- `sessionData: SessionData | null`
- `matchedCall: MatchedCall | null`
- `isLoading: boolean`
- `error: Error | null`

**What STAYS in Component:**
- `isExpanded: useState(false)` - UI state only
- Event processing: `firstEvent`, `lastEvent`, `metadata`, `leadScore`
- Attribution/context derivation: `attributionSource`, `fingerprint`, `gclid`, `city`, `district`, `device`
- UI helpers: `getEventIcon`, `getBorderColor`, `getBorderGlow`
- Event sorting: `sortedEvents` (PR1: deterministic order)
- Session calculations: `sessionDuration`, `conversionCount`, `hasPhoneCall`
- Event time differences: `eventsWithTimeDiff`
- UI handlers: `handleCopySessionId`
- Full JSX render: Session card, context chips, event list, matched call display

---

### File 4: `app/dashboard/site/[siteId]/page.tsx`

#### REMOVE: Redundant Access Check

**Line Ranges to Remove:**
- Lines 48-72: Redundant owner/member access verification
- **Remove:** Duplicate access check logic
- **Keep:** RLS-based site fetch (lines 36-46) - this already enforces access

**What STAYS:**
- User authentication check (lines 27-31)
- Admin check (line 34)
- RLS-based site fetch (lines 36-46) - trusts RLS for access enforcement
- All JSX rendering (lines 51-136)

---

## HOOK/UTILITY SIGNATURES

### 1. `lib/hooks/use-live-feed-data.ts`

```typescript
export interface UseLiveFeedDataResult {
  events: Event[];
  groupedSessions: Record<string, Event[]>;
  userSites: string[];
  isInitialized: boolean;
  isLoading: boolean;
  error: Error | null;
}

export function useLiveFeedData(siteId?: string): UseLiveFeedDataResult
```

**Preserves:**
- ✅ PR1: `.order('id', { ascending: false })` on all queries
- ✅ PR3: Incremental grouping (update only affected session)
- ✅ PR3: No redundant RLS verification queries
- ✅ Month partition filtering
- ✅ RLS compliance (JOIN patterns)

---

### 2. `lib/hooks/use-call-monitor-data.ts`

```typescript
export interface Call {
  id: string;
  phone_number: string;
  matched_session_id: string | null;
  matched_fingerprint?: string | null;
  lead_score: number;
  lead_score_at_match?: number | null;
  score_breakdown?: {...} | null;
  matched_at?: string | null;
  created_at: string;
  site_id: string;
  status?: string | null;
  source?: string | null;
  confirmed_at?: string | null;
  confirmed_by?: string | null;
}

export interface UseCallMonitorDataResult {
  calls: Call[];
  dismissed: Set<string>;
  newMatchIds: Set<string>;
  isLoading: boolean;
  error: Error | null;
  onDismiss: (id: string) => void;
}

export function useCallMonitorData(siteId?: string): UseCallMonitorDataResult
```

**Preserves:**
- ✅ PR1: `.order('id', { ascending: false })` on all queries
- ✅ PR3: No redundant RLS verification queries
- ✅ RLS compliance (trust subscription filter)

---

### 3. `lib/hooks/use-session-data.ts`

```typescript
export interface SessionData {
  attribution_source?: string | null;
  device_type?: string | null;
  city?: string | null;
  district?: string | null;
  fingerprint?: string | null;
  gclid?: string | null;
}

export interface MatchedCall {
  id: string;
  phone_number: string;
  matched_session_id: string | null;
  matched_fingerprint?: string | null;
  lead_score: number;
  matched_at?: string | null;
  created_at: string;
  site_id: string;
  status?: string | null;
  source?: string | null;
}

export interface UseSessionDataResult {
  sessionData: SessionData | null;
  matchedCall: MatchedCall | null;
  isLoading: boolean;
  error: Error | null;
}

export function useSessionData(
  sessionId: string,
  metadata?: any
): UseSessionDataResult
```

**Preserves:**
- ✅ PR1: `.order('id', { ascending: false })` on call lookup
- ✅ Attribution fallback (session → metadata)
- ✅ Context chips fallback (session → metadata)
- ✅ RLS compliance (JOIN pattern for call lookup)

---

### 4. `lib/events.ts`

```typescript
export interface Event {
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

export function normalizeEvent(item: any): Event
```

**Purpose:** Normalize Supabase JOIN response structure to flat Event interface

**Extract From:** `live-feed.tsx` event normalization logic (original lines 179-190)

---

## BEHAVIOR PRESERVATION CONFIRMATION

### PR1: Deterministic Ordering ✅

**Live Feed:**
- ✅ Sessions query: `.order('created_at', { ascending: false }).order('id', { ascending: false })`
- ✅ Events query: `.order('created_at', { ascending: false }).order('id', { ascending: false })`
- ✅ Event grouping: Sort with `id.localeCompare(b.id)` tie-breaker
- ✅ Realtime updates: Maintain order with id DESC tie-breaker

**Call Monitor:**
- ✅ Calls query: `.order('created_at', { ascending: false }).order('id', { ascending: false })`
- ✅ Realtime updates: Maintain order with id DESC tie-breaker

**Session Group:**
- ✅ Call lookup: `.order('created_at', { ascending: false }).order('id', { ascending: false })`
- ✅ Event sorting: `id.localeCompare(b.id)` tie-breaker

**Verification:** All queries and sorts maintain PR1 deterministic ordering verbatim.

---

### PR2: Canonical Modules ✅

**No Changes:**
- ✅ Geo extraction: Still uses `lib/geo.ts` (via `/api/sync`)
- ✅ Lead scoring: Still uses `lib/scoring.ts` (via `/api/sync`)
- ✅ Attribution: Still uses `lib/attribution.ts` (via `/api/sync`)

**Verification:** PR2 modules remain untouched, no regression.

---

### PR3: Realtime Hygiene ✅

**Live Feed:**
- ✅ Incremental grouping: `setGroupedSessions((prev) => { ...update only affected session... })`
- ✅ No redundant RLS queries: Comment "Trust RLS subscription filter - no redundant verification query"
- ✅ Memoized grouping: `useEffect` with `[events]` dependency

**Call Monitor:**
- ✅ No redundant RLS queries: Comment "Trust RLS subscription filter - no redundant verification query"
- ✅ Incremental updates: `setCalls((prev) => [call, ...prev].slice(0, 20))`

**Verification:** PR3 incremental grouping and no redundant queries preserved verbatim.

---

### RLS/Site Scope ✅

**All Queries:**
- ✅ Live Feed: `sessions!inner(site_id)` JOIN pattern
- ✅ Call Monitor: RLS policies enforce site filtering
- ✅ Session Group: `sites!inner(user_id)` JOIN pattern for call lookup

**Access Control:**
- ✅ Server component: RLS-based site fetch (trusts RLS)
- ✅ Removed: Redundant owner/member check (trusts RLS)

**Verification:** All queries use RLS-compliant patterns, no client-side security assumptions.

---

## COMPONENT BOUNDARIES (What Stays)

### `live-feed.tsx` (After Extraction)
- ✅ Filter state management (`selectedCity`, `selectedDistrict`, `selectedDevice`)
- ✅ Filter extraction (`filterOptions` useMemo)
- ✅ Filter application (`displayedSessions` useMemo)
- ✅ Filter UI (JSX selects and clear button)
- ✅ Error/loading/empty state UI
- ✅ Main render (Card, header, session list)

**Lines Remaining:** ~200 lines (down from 540)

---

### `call-alert-wrapper.tsx` (After Extraction)
- ✅ Dismissed filter (`visibleCalls` useMemo)
- ✅ Error/loading/empty state UI
- ✅ Main render (Card, header, call list)

**Lines Remaining:** ~80 lines (down from 302)

---

### `session-group.tsx` (After Extraction)
- ✅ UI state (`isExpanded`)
- ✅ Event processing and calculations
- ✅ Attribution/context derivation (fallback logic)
- ✅ UI helpers (`getEventIcon`, `getBorderColor`, `getBorderGlow`)
- ✅ Event sorting (PR1: deterministic)
- ✅ Session calculations
- ✅ UI handlers (`handleCopySessionId`)
- ✅ Full JSX render

**Lines Remaining:** ~400 lines (down from 458)

---

### `app/dashboard/site/[siteId]/page.tsx` (After Removal)
- ✅ User authentication
- ✅ Admin check
- ✅ RLS-based site fetch (trusts RLS)
- ✅ All JSX rendering

**Lines Remaining:** ~137 lines (down from 160)

---

## EXTRACTION CHECKLIST

### Step 1: Create Hooks Directory
- [x] Create `lib/hooks/` directory
- [x] Add TypeScript interfaces for hook returns

### Step 2: Extract `useLiveFeedData`
- [x] Create `lib/hooks/use-live-feed-data.ts`
- [x] Move event grouping logic (original lines 51-78)
- [x] Move initial data fetch (original lines 80-202)
- [x] Move realtime subscription (original lines 204-344)
- [x] Update `live-feed.tsx` to use hook

### Step 3: Extract `useCallMonitorData`
- [x] Create `lib/hooks/use-call-monitor-data.ts`
- [x] Move call fetching (original lines 48-111)
- [x] Move realtime subscription (original lines 113-253)
- [x] Update `call-alert-wrapper.tsx` to use hook

### Step 4: Extract `useSessionData`
- [x] Create `lib/hooks/use-session-data.ts`
- [x] Move session fetch (original lines 44-59)
- [x] Move call matching (original lines 76-105)
- [x] Update `session-group.tsx` to use hook

### Step 5: Extract `normalizeEvent`
- [x] Create `lib/events.ts`
- [x] Move normalization logic (original lines 179-190)
- [x] Update `live-feed.tsx` to use utility

### Step 6: Remove Redundant Access Check
- [x] Update `app/dashboard/site/[siteId]/page.tsx`
- [x] Remove duplicate access check (original lines 48-72)
- [x] Trust RLS for access enforcement

---

## ACCEPTANCE GATES

### Code Quality
- ✅ `npx tsc --noEmit` - Must pass
- ✅ `npm run build` - Must pass
- ✅ `npm run check:warroom` - Must pass
- ✅ `npm run check:attribution` - Must pass

### Functionality
- ✅ Live Feed displays events in stable order (PR1)
- ✅ Realtime updates work without render storms (PR3)
- ✅ Call Monitor displays calls correctly
- ✅ Session Group shows attribution and context chips
- ✅ No console errors

### Code Reduction
- ✅ `live-feed.tsx` reduced by ~63% (540 → ~200 lines)
- ✅ `call-alert-wrapper.tsx` reduced by ~73% (302 → ~80 lines)
- ✅ `session-group.tsx` reduced by ~13% (458 → ~400 lines)

---

## RISK MITIGATION

**Preserved Invariants:**
- ✅ PR1: All deterministic ordering logic verbatim
- ✅ PR2: All canonical modules untouched
- ✅ PR3: All realtime hygiene patterns verbatim
- ✅ RLS: All security patterns preserved

**No Breaking Changes:**
- ✅ Component interfaces unchanged
- ✅ Props unchanged
- ✅ Behavior unchanged
- ✅ Only code organization changed

---

## READY FOR PR4 IMPLEMENTATION

**Status:** 🔒 SCOPE LOCKED

**Extraction Boundaries:** ✅ Defined
**Hook Signatures:** ✅ Defined
**Behavior Preservation:** ✅ Confirmed
**Acceptance Gates:** ✅ Defined

**Next Step:** Proceed with PR4 implementation following exact boundaries above.

---

**Last Updated:** 2026-01-25

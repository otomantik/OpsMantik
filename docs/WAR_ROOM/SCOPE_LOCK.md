# SCOPE LOCK - PR1, PR5, PR6 Exact File Locations

**Date:** 2026-01-25  
**Purpose:** Lock exact file paths and line numbers for surgical PRs

---

## PR1: CANONICAL SORTING & TIME SEMANTICS

**Title:** `fix: add deterministic sorting with tie-breaker (id DESC)`

**Why:** Non-deterministic sorting when multiple items have same `created_at` timestamp causes UI jump on realtime updates and inconsistent order between page loads.

---

### Database Queries (4 locations)

1. **`components/dashboard/live-feed.tsx:141`**
   - **Query:** Sessions fetch
   - **Current:** `.order('created_at', { ascending: false })`
   - **Fix:** Add `.order('id', { ascending: false })` after
   - **Why:** Sessions query needs tie-breaker for deterministic order

2. **`components/dashboard/live-feed.tsx:160`**
   - **Query:** Events fetch
   - **Current:** `.order('created_at', { ascending: false })`
   - **Fix:** Add `.order('id', { ascending: false })` after
   - **Why:** Events query needs tie-breaker (critical for realtime updates)

3. **`components/dashboard/call-alert-wrapper.tsx:74`**
   - **Query:** Calls fetch (siteId path)
   - **Current:** `.order('created_at', { ascending: false })`
   - **Fix:** Add `.order('id', { ascending: false })` after
   - **Why:** Calls query needs tie-breaker for stable Call Monitor order

4. **`components/dashboard/call-alert-wrapper.tsx:98`**
   - **Query:** Calls fetch (multi-site path)
   - **Current:** `.order('created_at', { ascending: false })`
   - **Fix:** Add `.order('id', { ascending: false })` after
   - **Why:** Same as above, different code path

---

### Client-Side Sorts (2 locations)

5. **`components/dashboard/session-group.tsx:139-142`**
   - **Sort:** Events within session (oldest to newest)
   - **Current:** `sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())`
   - **Fix:** Add id tie-breaker in comparator
   - **Why:** Events within same session can have same timestamp, need deterministic order

6. **`components/dashboard/tracked-events-panel.tsx:84-89`**
   - **Sort:** Event types by count
   - **Current:** `sort((a, b) => b.count - a.count)`
   - **Fix:** Add `lastSeen DESC` tie-breaker
   - **Why:** If same count, use lastSeen for deterministic order

---

### Additional Queries (Not in PR1, but should be consistent)

7. **`components/dashboard/sites-manager.tsx:57`**
   - **Query:** Sites fetch
   - **Current:** `.order('created_at', { ascending: false })`
   - **Note:** Could add tie-breaker, but lower priority (sites rarely have same timestamp)

8. **`components/dashboard/site-switcher.tsx:43`**
   - **Query:** Sites fetch
   - **Current:** `.order('created_at', { ascending: false })`
   - **Note:** Same as above

9. **`components/dashboard/conversion-tracker.tsx:62`**
   - **Query:** Events fetch (conversions)
   - **Current:** `.order('created_at', { ascending: false })`
   - **Note:** Could add tie-breaker for consistency

10. **`components/dashboard/session-group.tsx:88`**
    - **Query:** Calls fetch (matched call lookup)
    - **Current:** `.order('created_at', { ascending: false })`
    - **Note:** Single result (`.maybeSingle()`), tie-breaker less critical

---

## PR5: GUARDRAILS & IDEMPOTENCY

**Title:** `fix: add idempotency guards for Confirm/Junk actions`

**Why:** Race condition risk - user can double-click Confirm/Junk, causing duplicate updates or errors. No optimistic lock or status check before update.

---

### Action Handlers (2 locations)

1. **`components/dashboard/call-alert.tsx:131-151`**
   - **Function:** `handleConfirm()`
   - **Current:** Direct update without status check
   - **Fix:** Add optimistic lock - check current status before update
   - **Why:** Prevent double-confirm race condition
   - **Lines:** 131-151 (function definition)

2. **`components/dashboard/call-alert.tsx:153-163`**
   - **Function:** `handleJunk()`
   - **Current:** Direct update without status check
   - **Fix:** Add status check (optional, but consistent)
   - **Why:** Prevent double-junk (less critical, but good practice)
   - **Lines:** 153-163 (function definition)

---

### Additional Action Handler (Not in PR5, but related)

3. **`components/dashboard/call-alert.tsx:117-129`**
   - **Function:** `handleQualify()`
   - **Current:** Direct update without status check
   - **Note:** Could add idempotency, but lower priority (qualify is less critical than confirm)

---

## PR6: MOBILE HARDENING PASS

**Title:** `fix: mobile responsive improvements (CSS/layout only)`

**Why:** Mobile viewport (<=390px) has overlap, overflow, small tap targets, and non-sticky filters causing poor UX.

---

### Fixed Positioning & Overlap (2 locations)

1. **`app/dashboard/site/[siteId]/page.tsx:80`**
   - **Issue:** Fixed Call Monitor overlaps content on mobile
   - **Current:** `className="fixed top-6 right-6 z-50 w-72"`
   - **Fix:** Add responsive: `hidden lg:block` or `w-full lg:w-72`, add mobile bottom sheet
   - **Why:** 288px fixed width causes horizontal overflow on 390px viewport

2. **`app/dashboard/site/[siteId]/page.tsx:84`**
   - **Issue:** `pr-80` padding causes horizontal overflow
   - **Current:** `className="max-w-[1920px] mx-auto pr-80"`
   - **Fix:** Add responsive: `pr-0 lg:pr-80`
   - **Why:** 320px padding too large for mobile viewport

---

### Tap Targets (1 location)

3. **`components/dashboard/call-alert.tsx:238-256`**
   - **Issue:** Action buttons too small (<44px)
   - **Current:** `className="h-7 w-7 p-0"` (28px)
   - **Fix:** Increase to `h-10 w-10 lg:h-7 lg:w-7` (40px on mobile, 28px on desktop)
   - **Why:** iOS/Android minimum tap target is 44px
   - **Lines:** 238-256 (button container with Confirm/Junk/Qualify buttons)

---

### Sticky Filters & Headers (2 locations)

4. **`components/dashboard/live-feed.tsx:447-533`**
   - **Issue:** Filter bar not sticky, lost on scroll
   - **Current:** Filter controls in CardHeader (not sticky)
   - **Fix:** Add `sticky top-0 z-10 bg-slate-900 border-b` to filter container
   - **Why:** Users lose filter context when scrolling
   - **Lines:** 447-533 (Card component with filter controls)

5. **`components/dashboard/live-feed.tsx:448`**
   - **Issue:** Card header not sticky (alternative fix)
   - **Current:** `CardHeader` component
   - **Fix:** Make header sticky or move filters outside card
   - **Why:** Filter controls scroll away

---

### Layout Overflow (2 locations)

6. **`components/dashboard/call-alert.tsx:191`**
   - **Issue:** Flex layout may overflow on small screens
   - **Current:** `className="flex items-start justify-between gap-3"`
   - **Fix:** Add responsive: `flex-col lg:flex-row`
   - **Why:** `justify-between` can cause horizontal overflow on mobile
   - **Lines:** 191-287 (card content layout)

7. **`components/dashboard/session-group.tsx:283-304`**
   - **Issue:** Context chips wrap badly, layout breaks
   - **Current:** `className="flex items-center gap-2 flex-wrap"`
   - **Fix:** Add `min-w-0` and ensure proper truncation
   - **Why:** Chips stack vertically, text may overflow
   - **Lines:** 283-304 (context chips container)

---

### Text Overflow (1 location)

8. **`components/dashboard/session-group.tsx:186`**
   - **Issue:** Long session ID text may overflow
   - **Current:** Session ID display without truncation
   - **Fix:** Add `truncate` or `break-words`
   - **Why:** Long UUIDs can overflow on small screens
   - **Lines:** 186 (session ID display)

---

### Grid Responsiveness (1 location)

9. **`app/dashboard/site/[siteId]/page.tsx:130`**
   - **Issue:** Grid may squeeze on mobile
   - **Current:** `className="grid grid-cols-12 gap-4"`
   - **Fix:** Add responsive: `grid-cols-1 lg:grid-cols-12`
   - **Why:** 12-column grid too narrow on mobile
   - **Lines:** 130 (main grid layout)

---

### Additional Mobile Issues (Lower Priority)

10. **`components/dashboard/tracked-events-panel.tsx:126`**
    - **Issue:** Scrollable list may have small tap targets
    - **Current:** `className="space-y-2 max-h-[400px] overflow-y-auto"`
    - **Fix:** Increase padding: `p-3` instead of `p-2` on event items
    - **Why:** Better tap targets for mobile
    - **Lines:** 126-160 (event items list)

11. **`components/dashboard/call-alert-wrapper.tsx`** (if mobile bottom sheet added)
    - **Issue:** Safe area (iOS) support needed
    - **Current:** N/A (if bottom sheet implemented)
    - **Fix:** Add `pb-safe lg:pb-0` or `padding-bottom: env(safe-area-inset-bottom)`
    - **Why:** iOS safe area support for bottom sheet

---

## SUMMARY

### PR1 Scope: 6 locations
- **Database Queries:** 4 locations (live-feed: 2, call-alert-wrapper: 2)
- **Client Sorts:** 2 locations (session-group: 1, tracked-events-panel: 1)
- **Additional (not in PR1):** 4 locations (sites-manager, site-switcher, conversion-tracker, session-group calls lookup)

### PR5 Scope: 2 locations
- **Action Handlers:** 2 locations (call-alert.tsx: handleConfirm, handleJunk)
- **Additional (not in PR5):** 1 location (handleQualify - lower priority)

### PR6 Scope: 9 locations
- **Fixed Positioning:** 2 locations (dashboard site page)
- **Tap Targets:** 1 location (call-alert buttons)
- **Sticky Filters:** 2 locations (live-feed filter bar + header)
- **Layout Overflow:** 2 locations (call-alert layout, session-group chips)
- **Text Overflow:** 1 location (session-group ID)
- **Grid Responsiveness:** 1 location (dashboard site page grid)
- **Additional:** 2 locations (tracked-events-panel padding, safe area support)

---

## ASSUMPTIONS

1. **PR1:** All `.order('created_at')` queries need tie-breaker (assumption: UUID `id` is always unique and sortable)
2. **PR5:** Only `handleConfirm` and `handleJunk` need idempotency (assumption: `handleQualify` is less critical)
3. **PR6:** Mobile breakpoint is `lg:` (1024px) - Tailwind default (assumption: 390px mobile, 1024px+ desktop)
4. **PR6:** Tap target minimum is 44px (iOS/Android standard) - verified in MOBILE_ISSUES.md

---

**READY FOR PR1**

**Last Updated:** 2026-01-25

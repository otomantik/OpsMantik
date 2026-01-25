# DATA FLOW - CIQ & Live Feed Pipeline

**Date:** 2026-01-25  
**Purpose:** Trace data flow for CIQ and Live Feed systems

---

## CIQ (Call Intent Queue) DATA FLOW

### 1. Intent Creation (Server)
**Source:** `app/api/sync/route.ts` (Step D, lines 507-567)

**Trigger:**
- `event_category === 'conversion'`
- `event_action` contains 'phone'/'whatsapp'
- `fingerprint` exists

**Process:**
1. Extract phone number from `event_label` or `meta.phone_number`
2. Dedupe check: Query `calls` table for existing intent within 60s
   - Filter: `site_id`, `matched_session_id`, `source='click'`, `status='intent'`, `created_at >= 60s ago`
3. If no duplicate: Insert call intent
   - Fields: `site_id`, `phone_number`, `matched_session_id`, `matched_fingerprint`, `lead_score`, `status='intent'`, `source='click'`

**Data Source:** `calls` table
**RLS:** Enforced (admin client server-side)

---

### 2. Intent Display (Client)
**Source:** `components/dashboard/call-alert-wrapper.tsx`

**Initial Fetch:**
- Query: `calls` table
- Filter: `site_id`, `status IN ('intent', 'confirmed', 'qualified', 'real', null)`
- Sort: `created_at DESC`
- Limit: 20

**Realtime Subscription:**
- Channel: `calls-realtime`
- Event: `INSERT` on `calls` table
- Verification: Re-query with RLS check
- Filter: Site ownership check (client-side)

**State Management:**
- `calls` state array
- `dismissed` Set (local)
- `newMatchIds` Set (for flashing)
- `previousCallIdsRef` (for dedupe)

**Sorting:**
- Database: `ORDER BY created_at DESC`
- No tie-breaker (potential non-deterministic order)

---

### 3. Intent Actions (Client)
**Source:** `components/dashboard/call-alert.tsx`

**Confirm Action:**
- Update: `status='confirmed'`, `confirmed_at=now()`, `confirmed_by=user.id`
- State: Local `status` state updated
- **Issue:** No idempotency guard (can double-confirm)

**Junk Action:**
- Update: `status='junk'`
- State: Local `status` state updated
- Auto-dismiss: After 1s delay

**Sorting:**
- None (relies on DB order)

---

## LIVE FEED DATA FLOW

### 1. Initial Load (Client)
**Source:** `components/dashboard/live-feed.tsx` (lines 71-191)

**Process:**
1. Fetch user sites (or use provided `siteId`)
2. Fetch recent sessions (current month, limit 50)
3. Fetch recent events (current month, limit 100)
   - JOIN: `sessions!inner(site_id)` for RLS
4. Group events by `session_id`
5. Set state: `events`, `groupedSessions`

**Sorting:**
- Sessions: `ORDER BY created_at DESC` (no tie-breaker)
- Events: `ORDER BY created_at DESC` (no tie-breaker)
- **Issue:** Non-deterministic if same timestamp

---

### 2. Realtime Updates (Client)
**Source:** `components/dashboard/live-feed.tsx` (lines 193-338)

**Subscription:**
- Channel: `events-realtime`
- Event: `INSERT` on `events` table
- Filter: `session_month === currentMonth` (client-side check)
- Verification: Re-query with JOIN for RLS

**Update Logic:**
1. Check partition (`session_month`)
2. Verify site ownership (JOIN query)
3. Prepend to `events` array: `[newEvent, ...prev].slice(0, 100)`
4. Re-group: `groupEventsBySessionRef.current(updated)`

**Sorting:**
- New events prepended (maintains DESC order)
- **Issue:** No tie-breaker, potential UI jump on same timestamp

---

### 3. Filtering & Display (Client)
**Source:** `components/dashboard/live-feed.tsx` (lines 340-381)

**Filter Extraction:**
- Client-side: Extract unique cities/districts/devices from `groupedSessions`
- Memoized: `useMemo` on `groupedSessions`

**Filter Application:**
- Client-side: Filter `groupedSessions` entries
- Filter: `metadata.city`, `metadata.district`, `metadata.device_type`
- **Issue:** Filters on event metadata, not session normalized fields

**Display:**
- Limit: 10 sessions
- Sort: None (relies on grouping order)

---

### 4. Session Data Fetch (Client)
**Source:** `components/dashboard/session-group.tsx` (lines 44-59)

**Process:**
1. Fetch session data: `attribution_source`, `device_type`, `city`, `district`, `fingerprint`, `gclid`
2. Fallback: Use event metadata if session fields missing

**Data Source:** `sessions` table
**RLS:** Enforced (anon client)

**Sorting:**
- Events within session: `sort((a, b) => new Date(a.created_at) - new Date(b.created_at))`
- **Issue:** No tie-breaker

---

## TRANSFORMATION POINTS

### Attribution Computation
**Location:** `lib/attribution.ts` → `computeAttribution()`
**Called From:** `app/api/sync/route.ts` (line 296)
**Output:** `{ source: string, isPaid: boolean }`
**Storage:** `sessions.attribution_source`, `events.metadata.attribution_source`

### Context Extraction
**Location:** `app/api/sync/route.ts` (lines 218-266)
**Process:**
- Device: UAParser → normalize to desktop/mobile/tablet
- City/District: Metadata override > Headers > null
**Storage:** `sessions.city`, `sessions.district`, `sessions.device_type`

### Event Normalization
**Location:** `components/dashboard/live-feed.tsx` (lines 168-179)
**Process:** Extract nested JOIN structure to flat Event interface
**Issue:** Ad-hoc transformation, not centralized

---

## SORTING SEMANTICS

### Current State
- **Events:** `created_at DESC` (no tie-breaker)
- **Sessions:** `created_at DESC` (no tie-breaker)
- **Calls:** `created_at DESC` (no tie-breaker)
- **Session Events:** `created_at ASC` (oldest first)

### Issues
1. **Non-deterministic:** Same `created_at` → random order
2. **UI Jump:** Realtime updates can reorder items
3. **No Tie-Breaker:** Should use `id` as secondary sort

---

## RLS COMPLIANCE PATTERNS

### Server-Side
- Admin client: `@/lib/supabase/admin` (service role)
- Used in: `/api/sync`, `/api/call-event`

### Client-Side
- Anon client: `@/lib/supabase/client`
- JOIN patterns: `sessions!inner(site_id)` for RLS
- Used in: All dashboard components

---

**Last Updated:** 2026-01-25

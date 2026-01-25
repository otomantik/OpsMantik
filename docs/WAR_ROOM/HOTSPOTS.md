# HOTSPOTS - High-Risk Files & Modules

**Date:** 2026-01-25  
**Purpose:** Identify files with too many responsibilities, high churn, mixed concerns

---

## TOP 10 HOTSPOTS

### 1. `components/dashboard/live-feed.tsx` (533 lines)
**Risk Level:** 🔴 HIGH

**Responsibilities:**
- Data fetching (initial + realtime)
- Realtime subscription management
- Event grouping logic
- Filter extraction (client-side)
- Filter application (client-side)
- UI rendering
- State management (events, groupedSessions, filters, userSites)

**Issues:**
- 14+ hooks (useEffect, useState, useCallback, useMemo)
- Mixed concerns: data + transform + render
- Complex subscription cleanup logic
- Ad-hoc event normalization
- Client-side filtering (should be server-side or memoized better)

**Churn Risk:** HIGH (frequent changes for filters, realtime, sorting)

---

### 2. `app/api/sync/route.ts` (672 lines)
**Risk Level:** 🟡 MEDIUM

**Responsibilities:**
- Event ingestion
- Session creation/update
- Attribution computation
- Context extraction (device, geo)
- Lead scoring
- Call intent creation
- Event insertion

**Issues:**
- Long function (672 lines)
- Multiple concerns in one route
- Attribution logic embedded (should use lib/attribution.ts - ✅ already does)
- Geo extraction embedded
- Lead scoring embedded

**Churn Risk:** MEDIUM (core logic, but well-structured)

---

### 3. `components/dashboard/call-alert-wrapper.tsx` (314 lines)
**Risk Level:** 🟡 MEDIUM

**Responsibilities:**
- Call fetching (initial + realtime)
- Realtime subscription management
- Call state management
- Dismissal logic
- New match detection

**Issues:**
- 9+ hooks
- Complex timeout management (`timeoutRefsRef`)
- Duplicate subscription detection
- Client-side site filtering

**Churn Risk:** MEDIUM (realtime logic changes)

---

### 4. `components/dashboard/session-group.tsx` (451 lines)
**Risk Level:** 🟡 MEDIUM

**Responsibilities:**
- Session data fetching
- Call matching (fingerprint lookup)
- Event sorting
- UI rendering (session card)
- Context chips rendering
- Attribution display

**Issues:**
- Multiple data sources (sessions table + event metadata)
- Fallback logic (session → metadata)
- Call lookup embedded
- Complex state (sessionData, matchedCall, expanded)

**Churn Risk:** MEDIUM (UI changes, attribution display)

---

### 5. `components/dashboard/call-alert.tsx` (440 lines)
**Risk Level:** 🟢 LOW-MEDIUM

**Responsibilities:**
- Call card rendering
- Status updates (Confirm/Junk/Qualify)
- Session jump logic
- Audio/flash effects
- Expanded details

**Issues:**
- Status update logic (no idempotency)
- Audio effects embedded
- Complex conditional rendering

**Churn Risk:** LOW-MEDIUM (UI polish, status workflow)

---

### 6. `app/dashboard/site/[siteId]/page.tsx` (155 lines)
**Risk Level:** 🟢 LOW

**Responsibilities:**
- Site access verification
- Component composition
- Layout structure

**Issues:**
- Access check duplicated (owner OR member OR admin)
- Could use RLS-only (simpler)

**Churn Risk:** LOW (stable routing)

---

### 7. `components/dashboard/stats-cards.tsx` (204 lines)
**Risk Level:** 🟢 LOW

**Responsibilities:**
- Stats fetching
- Aggregation (sessions, events, avg score)
- UI rendering

**Issues:**
- Client-side aggregation (could be RPC)
- Complex query logic

**Churn Risk:** LOW (stable metrics)

---

### 8. `components/dashboard/tracked-events-panel.tsx` (165 lines)
**Risk Level:** 🟢 LOW

**Responsibilities:**
- Event type fetching
- Grouping by category+action
- Sorting by count
- UI rendering

**Issues:**
- Client-side grouping (could be RPC)
- Polling interval (60s) - could use realtime

**Churn Risk:** LOW (stable panel)

---

### 9. `lib/utils.ts` (99 lines)
**Risk Level:** 🟢 LOW

**Responsibilities:**
- Utility functions (cn, isDebugEnabled, jumpToSession, maskFingerprint, getConfidence)
- Global window exposure

**Issues:**
- Mixed utilities (could be split)
- Global exposure (jumpToSession)

**Churn Risk:** LOW (stable utilities)

---

### 10. `lib/attribution.ts` (110 lines)
**Risk Level:** 🟢 LOW

**Responsibilities:**
- Attribution computation (single source of truth ✅)
- UTM extraction

**Issues:**
- None (well-structured, single responsibility)

**Churn Risk:** LOW (stable logic)

---

## PATTERNS IDENTIFIED

### High Churn Areas
1. **Live Feed** - Filters, realtime, sorting changes
2. **Call Monitor** - Status workflow, UI polish
3. **Session Cards** - Attribution display, context chips

### Stable Areas
1. **Attribution Logic** - Single source of truth ✅
2. **API Routes** - Well-structured, minimal changes
3. **Utils** - Stable helpers

### Mixed Concerns
1. **Live Feed** - Data + transform + render
2. **Call Alert Wrapper** - Fetch + subscription + state
3. **Session Group** - Fetch + match + render

---

**Last Updated:** 2026-01-25

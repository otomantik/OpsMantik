# ISSUES LEDGER - Spaghetti, Logic Breaks, Redundancy

**Date:** 2026-01-25  
**Purpose:** Complete issue inventory for surgical refactoring

---

## LOGIC LINE BREAKS

| ID | Category | Impact | Evidence | Why Wrong | Minimal Fix | Risk | PR |
|----|----------|--------|----------|-----------|-------------|------|-----|
| **L1** | LogicBreak | High | `components/dashboard/live-feed.tsx:160` - `ORDER BY created_at DESC` (no tie-breaker) | Non-deterministic sorting: same timestamp → random order, UI jump on realtime updates | Add `id DESC` as secondary sort: `.order('created_at', { ascending: false }).order('id', { ascending: false })` | Low | PR1 |
| **L2** | LogicBreak | High | `components/dashboard/call-alert-wrapper.tsx:74,98` - `ORDER BY created_at DESC` (no tie-breaker) | Same issue: non-deterministic call order | Add `id DESC` as secondary sort | Low | PR1 |
| **L3** | LogicBreak | Medium | `components/dashboard/session-group.tsx:139` - `sort((a, b) => new Date(a.created_at) - new Date(b.created_at))` (no tie-breaker) | Events within session can reorder if same timestamp | Add `id` as secondary sort | Low | PR1 |
| **L4** | LogicBreak | Medium | `components/dashboard/call-alert.tsx:131-151` - `handleConfirm()` no idempotency guard | Can double-confirm intent (race condition) | Add optimistic lock: check current status before update | Medium | PR5 |
| **L5** | LogicBreak | Low | `components/dashboard/live-feed.tsx:372-374` - Filters on `metadata.city/district/device_type` instead of session fields | Inconsistent: should prefer session normalized fields | Filter on session data first, fallback to metadata | Low | PR2 |
| **L6** | LogicBreak | Low | `components/dashboard/tracked-events-panel.tsx:84` - `sort((a, b) => b.count - a.count)` (no tie-breaker) | Non-deterministic if same count | Add `lastSeen DESC` or `action ASC` as secondary sort | Low | PR1 |

---

## SPAGHETTI SYMPTOMS

| ID | Category | Impact | Evidence | Why Wrong | Minimal Fix | Risk | PR |
|----|----------|--------|----------|-----------|-------------|------|-----|
| **S1** | Spaghetti | High | `components/dashboard/live-feed.tsx` - 533 lines, 14+ hooks, data+transform+render mixed | Single file does too much: fetch, subscribe, group, filter, render | Extract data fetching to custom hook `useLiveFeed(siteId)` | Medium | PR4 |
| **S2** | Spaghetti | Medium | `components/dashboard/live-feed.tsx:168-179` - Ad-hoc event normalization | Event transformation scattered, not centralized | Extract to `lib/events.ts`: `normalizeEvent(rawEvent)` | Low | PR4 |
| **S3** | Spaghetti | Medium | `components/dashboard/call-alert-wrapper.tsx` - 314 lines, fetch+subscribe+state mixed | Similar to Live Feed: too many concerns | Extract data fetching to custom hook `useCallMonitor(siteId)` | Medium | PR4 |
| **S4** | Spaghetti | Low | `components/dashboard/session-group.tsx:44-59` - Session fetch embedded in component | Data fetching mixed with rendering | Extract to custom hook `useSessionData(sessionId)` | Low | PR4 |
| **S5** | Spaghetti | Low | `app/api/sync/route.ts:218-266` - Geo extraction embedded | Should be in utility module | Extract to `lib/geo.ts`: `extractGeoInfo(req, meta)` | Low | PR2 |
| **S6** | Spaghetti | Low | `app/api/sync/route.ts:321-342` - Lead scoring embedded | Should be in utility module | Extract to `lib/scoring.ts`: `computeLeadScore(event, referrer, isReturningAdUser)` | Low | PR2 |

---

## REDUNDANCY / DEAD CODE

| ID | Category | Impact | Evidence | Why Wrong | Minimal Fix | Risk | PR |
|----|----------|--------|----------|-----------|-------------|------|-----|
| **R1** | Redundancy | Low | `components/dashboard/live-feed.tsx:52-61` - `groupEventsBySession` callback + ref pattern | Over-engineered: callback wrapped in ref unnecessarily | Simplify: use `useCallback` directly, remove ref wrapper | Low | PR4 |
| **R2** | Redundancy | Low | `components/dashboard/call-alert-wrapper.tsx:120-132` - Duplicate subscription detection (same pattern in Live Feed) | Code duplication | Extract to utility: `useRealtimeSubscription(channel, handler, deps)` | Low | PR3 |
| **R3** | Redundancy | Low | `components/dashboard/live-feed.tsx:205-217` - Duplicate subscription detection | Same as R2 | Extract to shared utility | Low | PR3 |
| **R4** | Redundancy | Low | `app/dashboard/site/[siteId]/page.tsx:49-72` - Access check duplicated (owner OR member OR admin) | RLS already enforces this, redundant check | Remove duplicate check, rely on RLS only | Low | PR4 |
| **R5** | Redundancy | Low | `components/dashboard/session-group.tsx:62-65` - Attribution fallback: `sessionData?.attribution_source || metadata.attribution_source || 'Organic'` | Default 'Organic' redundant (computeAttribution always returns value) | Remove `|| 'Organic'` fallback | Low | PR2 |

---

## PERFORMANCE FOOTGUNS

| ID | Category | Impact | Evidence | Why Wrong | Minimal Fix | Risk | PR |
|----|----------|--------|----------|-----------|-------------|------|-----|
| **P1** | Perf | Medium | `components/dashboard/live-feed.tsx:291-297` - `setEvents` callback calls `groupEventsBySessionRef.current(updated)` | Re-grouping on every realtime update (expensive) | Debounce grouping or use `useMemo` on groupedSessions | Medium | PR3 |
| **P2** | Perf | Low | `components/dashboard/tracked-events-panel.tsx:95` - Polling interval (60s) instead of realtime | Unnecessary polling when realtime available | Switch to realtime subscription | Low | PR3 |
| **P3** | Perf | Low | `components/dashboard/live-feed.tsx:256-264` - Re-query on every realtime event for RLS verification | N+1 pattern (one query per event) | Batch verification or trust RLS (subscription already filtered) | Medium | PR3 |
| **P4** | Perf | Low | `components/dashboard/call-alert-wrapper.tsx:169-182` - Re-query on every realtime call for RLS verification | Same as P3 | Batch or trust RLS | Medium | PR3 |
| **P5** | Perf | Low | `components/dashboard/stats-cards.tsx:57-68` - Client-side aggregation | Could be RPC for better performance | Create RPC: `get_site_stats(site_id, days)` | Low | PR4 |

---

## SECURITY/ISOLATION RISKS

| ID | Category | Impact | Evidence | Why Wrong | Minimal Fix | Risk | PR |
|----|----------|--------|----------|-----------|-------------|------|-----|
| **SEC1** | Security | Low | `components/dashboard/live-feed.tsx:280` - Client-side site ownership check (`siteIds.includes(siteId)`) | Relies on client state, but RLS already enforces | Remove redundant check, trust RLS | Low | PR4 |
| **SEC2** | Security | Low | `components/dashboard/call-alert-wrapper.tsx:161` - Client-side site filtering | Same as SEC1 | Remove redundant check | Low | PR4 |
| **SEC3** | Security | Low | `app/dashboard/site/[siteId]/page.tsx:49-72` - Duplicate access check | RLS already enforces, redundant | Remove duplicate check | Low | PR4 |

---

## MOBILE UX ISSUES

| ID | Category | Impact | Evidence | Why Wrong | Minimal Fix | Risk | PR |
|----|----------|--------|----------|-----------|-------------|------|-----|
| **M1** | Mobile | High | `app/dashboard/site/[siteId]/page.tsx:80` - Fixed Call Monitor `w-72` (288px) on mobile | Overlaps content, not responsive | Add responsive: `hidden lg:block` or `w-full lg:w-72` | Low | Mobile PR |
| **M2** | Mobile | High | `components/dashboard/call-alert.tsx:238-256` - Action buttons in flex column, small tap targets | Buttons may be too small (<44px), hard to tap | Increase button size: `h-8 w-8` → `h-10 w-10` or `h-12 w-12` | Low | Mobile PR |
| **M3** | Mobile | Medium | `components/dashboard/live-feed.tsx:447-533` - Filter bar not sticky, lost on scroll | Users lose filter context | Add `sticky top-0 z-10 bg-slate-900` to filter bar | Low | Mobile PR |
| **M4** | Mobile | Medium | `components/dashboard/session-group.tsx:283-304` - Context chips wrap on small screens | Chips stack vertically, layout breaks | Add `flex-wrap` and `min-w-0` for proper wrapping | Low | Mobile PR |
| **M5** | Mobile | Low | `components/dashboard/call-alert.tsx:191-287` - Card layout uses `flex justify-between`, may overflow | Horizontal overflow on small screens | Add `flex-col lg:flex-row` responsive layout | Low | Mobile PR |
| **M6** | Mobile | Low | `components/dashboard/live-feed.tsx:447` - Card header not sticky | Filter controls scroll away | Make header sticky | Low | Mobile PR |
| **M7** | Mobile | Low | `app/dashboard/site/[siteId]/page.tsx:84` - `pr-80` padding for fixed Call Monitor | Causes horizontal overflow on mobile | Add responsive: `pr-0 lg:pr-80` | Low | Mobile PR |

---

## SUMMARY BY CATEGORY

**Logic Breaks:** 6 issues (L1-L6)  
**Spaghetti:** 6 issues (S1-S6)  
**Redundancy:** 5 issues (R1-R5)  
**Performance:** 5 issues (P1-P5)  
**Security:** 3 issues (SEC1-SEC3)  
**Mobile:** 7 issues (M1-M7)

**Total:** 32 issues

**High Impact:** 8 issues  
**Medium Impact:** 10 issues  
**Low Impact:** 14 issues

---

## MOBILE ISSUES DETAIL (See MOBILE_ISSUES.md for full details)

| ID | Screen | Viewport | Symptom | Fix |
|----|--------|----------|---------|-----|
| **M1** | Dashboard Site | 390px | Fixed Call Monitor overlaps content | `hidden lg:block` or bottom sheet |
| **M2** | Call Alert | 390px | Buttons too small (<44px) | `h-10 w-10 lg:h-7 lg:w-7` |
| **M3** | Live Feed | 390px | Filter bar not sticky | `sticky top-0 z-10` |
| **M4** | Session Group | 390px | Context chips wrap badly | `flex-wrap min-w-0` |
| **M5** | Call Alert | 390px | Layout overflow | `flex-col lg:flex-row` |
| **M6** | Live Feed | 390px | Header not sticky | Make header sticky |
| **M7** | Dashboard Site | 390px | `pr-80` causes overflow | `pr-0 lg:pr-80` |

**All Mobile Issues:** CSS/layout only, no logic changes. See `docs/WAR_ROOM/MOBILE_ISSUES.md` for detailed fixes.

---

**Last Updated:** 2026-01-25

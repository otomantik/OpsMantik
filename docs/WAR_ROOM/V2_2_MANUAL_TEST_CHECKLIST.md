# PRO Dashboard Migration v2.2 - Manual Test Checklist

**Date**: 2026-01-28  
**Purpose**: Manual testing checklist for Phase 1 & 4 implementation  
**Status**: Ready for Testing

---

## PRE-TEST SETUP

- [ ] Database migration applied: `20260128020000_rpc_contract_v2_2.sql`
- [ ] Application deployed/restarted
- [ ] Test site available with sample data
- [ ] Browser console open (F12) for error checking

---

## PHASE 1: RPC CONTRACT TESTS

### Test 1.1: get_dashboard_stats (date_from/date_to)

**Steps**:
1. Navigate to `/dashboard/site/[siteId]`
2. Open browser DevTools → Network tab
3. Filter by "rpc"
4. Observe `get_dashboard_stats` call

**Expected**:
- ✅ RPC called with `p_date_from` and `p_date_to` (not `p_days`)
- ✅ Stats cards display correctly
- ✅ No console errors
- ✅ Data matches date range selected

**Status**: ⬜ PASS / ⬜ FAIL

---

### Test 1.2: get_dashboard_timeline

**Steps**:
1. Navigate to dashboard
2. Change date range (try: Today, 7 days, 30 days)
3. Observe Timeline Chart
4. Check Network tab for `get_dashboard_timeline` call

**Expected**:
- ✅ Timeline chart loads without errors
- ✅ RPC called with correct date range
- ✅ Chart shows data points
- ✅ Granularity changes based on range (< 7d = hour, 7-30d = day, > 30d = week)
- ✅ No client-side aggregation warnings in console

**Status**: ⬜ PASS / ⬜ FAIL

---

### Test 1.3: get_dashboard_intents

**Steps**:
1. Navigate to dashboard
2. Scroll to Intent Ledger section
3. Apply filters (pending, sealed, junk, suspicious)
4. Use search box
5. Check Network tab for `get_dashboard_intents` call

**Expected**:
- ✅ Intent Ledger loads without errors
- ✅ RPC called with correct parameters
- ✅ Filters work correctly
- ✅ Search works correctly
- ✅ No client-side queries in Network tab (only RPC)

**Status**: ⬜ PASS / ⬜ FAIL

---

### Test 1.4: 6-Month Range Validation

**Steps**:
1. Navigate to dashboard
2. Try to select date range > 6 months (e.g., 7 months ago to today)
3. Check for error message

**Expected**:
- ✅ Error message displayed: "Date range exceeds maximum of 180 days"
- ✅ Range automatically clamped to 6 months
- ✅ No RPC calls with invalid ranges

**Status**: ⬜ PASS / ⬜ FAIL

---

### Test 1.5: Heartbeat Exclusion

**Steps**:
1. Navigate to dashboard
2. Check Timeline Chart
3. Verify no heartbeat events in data
4. Check Stats Cards - total_events should exclude heartbeats

**Expected**:
- ✅ Timeline chart shows no heartbeat spikes
- ✅ Stats cards event count excludes heartbeats
- ✅ RPC queries include `event_category != 'heartbeat'` filter

**Status**: ⬜ PASS / ⬜ FAIL

---

## PHASE 4: BREAKDOWN WIDGET TESTS

### Test 4.1: Breakdown Widget Display

**Steps**:
1. Navigate to dashboard
2. Locate Breakdown Widget in side panel
3. Verify widget displays

**Expected**:
- ✅ Breakdown Widget visible in side panel
- ✅ Default dimension: "source"
- ✅ Dimension selector buttons visible (source, device, city icons)
- ✅ Data displays correctly

**Status**: ⬜ PASS / ⬜ FAIL

---

### Test 4.2: Breakdown by Source

**Steps**:
1. Click "source" dimension button (TrendingUp icon)
2. Observe data
3. Check Network tab for `get_dashboard_breakdown` call

**Expected**:
- ✅ RPC called with `p_dimension: 'source'`
- ✅ List shows attribution sources (Organic, Paid, Direct, etc.)
- ✅ Each item shows count and percentage
- ✅ Sorted by count (descending)
- ✅ Top 10 items displayed

**Status**: ⬜ PASS / ⬜ FAIL

---

### Test 4.3: Breakdown by Device

**Steps**:
1. Click "device" dimension button (Smartphone icon)
2. Observe data
3. Check Network tab

**Expected**:
- ✅ RPC called with `p_dimension: 'device'`
- ✅ List shows device types (Desktop, Mobile, Tablet, etc.)
- ✅ Count and percentage displayed
- ✅ Sorted by count (descending)

**Status**: ⬜ PASS / ⬜ PASS

---

### Test 4.4: Breakdown by City

**Steps**:
1. Click "city" dimension button (MapPin icon)
2. Observe data
3. Check Network tab

**Expected**:
- ✅ RPC called with `p_dimension: 'city'`
- ✅ List shows cities
- ✅ Count and percentage displayed
- ✅ Sorted by count (descending)

**Status**: ⬜ PASS / ⬜ FAIL

---

### Test 4.5: Breakdown Date Range

**Steps**:
1. Change dashboard date range
2. Observe Breakdown Widget
3. Verify data updates

**Expected**:
- ✅ Breakdown data updates when date range changes
- ✅ RPC called with new date range
- ✅ Data reflects selected date range

**Status**: ⬜ PASS / ⬜ FAIL

---

## CROSS-SITE ISOLATION TESTS

### Test ISO.1: Site Isolation

**Steps**:
1. Login as user with multiple sites
2. Navigate to Site A dashboard
3. Check Network tab for RPC calls
4. Verify all RPCs include `p_site_id` for Site A
5. Switch to Site B dashboard
6. Verify RPCs use Site B's ID

**Expected**:
- ✅ All RPC calls include correct `p_site_id`
- ✅ No data from other sites visible
- ✅ Switching sites updates all widgets correctly

**Status**: ⬜ PASS / ⬜ FAIL

---

## PERFORMANCE TESTS

### Test PERF.1: Large Date Range

**Steps**:
1. Select maximum date range (6 months)
2. Observe load times
3. Check browser performance

**Expected**:
- ✅ Dashboard loads within reasonable time (< 5 seconds)
- ✅ No browser freezing
- ✅ RPC calls complete successfully
- ✅ No timeout errors

**Status**: ⬜ PASS / ⬜ FAIL

---

### Test PERF.2: Realtime Updates

**Steps**:
1. Keep dashboard open
2. Generate new events (via test page or real traffic)
3. Observe realtime updates

**Expected**:
- ✅ KPIs update optimistically (StatsCards)
- ✅ Charts do NOT redraw on every event (bounded refresh)
- ✅ Intent Ledger updates on call changes
- ✅ Breakdown Widget does NOT update on realtime (static)

**Status**: ⬜ PASS / ⬜ FAIL

---

## ERROR HANDLING TESTS

### Test ERR.1: Invalid Date Range

**Steps**:
1. Try to set date_from > date_to (via URL manipulation)
2. Observe error handling

**Expected**:
- ✅ Error message displayed
- ✅ Date range corrected automatically
- ✅ Dashboard still functional

**Status**: ⬜ PASS / ⬜ FAIL

---

### Test ERR.2: Network Failure

**Steps**:
1. Disable network (DevTools → Network → Offline)
2. Try to load dashboard
3. Re-enable network
4. Verify recovery

**Expected**:
- ✅ Error state displayed
- ✅ Retry button works
- ✅ Dashboard recovers when network restored

**Status**: ⬜ PASS / ⬜ FAIL

---

## ACCEPTANCE CHECKLIST

### Hard Rules Compliance

- [ ] ✅ No cross-site leakage (all RPCs scoped by site_id)
- [ ] ✅ date_from/date_to required (no p_days in new RPCs)
- [ ] ✅ Max 6 months range enforced
- [ ] ✅ Heartbeat events excluded from all queries
- [ ] ✅ No client-side aggregation (all hooks use RPCs)
- [ ] ✅ Realtime does not redraw charts (bounded refresh maintained)

### Functionality

- [ ] ✅ Stats Cards work with date range
- [ ] ✅ Timeline Chart uses RPC (no client-side aggregation)
- [ ] ✅ Intent Ledger uses RPC (no client-side queries)
- [ ] ✅ Breakdown Widget displays correctly
- [ ] ✅ All dimensions work (source, device, city)
- [ ] ✅ Date range changes update all widgets

### Performance

- [ ] ✅ Dashboard loads quickly (< 5s for 6-month range)
- [ ] ✅ No browser freezing
- [ ] ✅ RPC calls complete successfully

---

## TEST RESULTS

**Tester**: _________________  
**Date**: _________________  
**Environment**: ⬜ Production / ⬜ Staging / ⬜ Development

**Overall Status**: ⬜ PASS / ⬜ FAIL

**Notes**:
```
[Add any issues or observations here]
```

---

**Next Steps** (if FAIL):
1. Document specific failures
2. Check RPC migration applied correctly
3. Verify database permissions
4. Check browser console for errors
5. Review Network tab for failed RPC calls

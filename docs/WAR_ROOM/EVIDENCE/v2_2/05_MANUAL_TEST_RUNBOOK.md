# Manual Test Runbook - PRO Dashboard v2.2

**Duration**: 5-10 minutes  
**Date**: 2026-01-28  
**Target**: `/dashboard/site/[siteId]`

---

## Pre-Test Checklist

- [ ] Logged in to dashboard
- [ ] Have at least one site with data (sessions, events, calls)
- [ ] Browser console open (F12)
- [ ] Network tab open (to verify RPC calls)

---

## Test Steps

### Step 1: Navigate to Dashboard (30 seconds)

**Action**: Navigate to `/dashboard/site/[siteId]` (replace `[siteId]` with actual site ID)

**Expected Results**:
- ✅ Dashboard loads without errors
- ✅ KPI cards display (Visitors, Calls, Conversion Rate, Events)
- ✅ Timeline chart visible
- ✅ Intent Ledger visible
- ✅ Breakdown Widget visible in side panel
- ✅ No console errors

**Screenshot**: `01_dashboard_loaded.png`
- Capture: Full dashboard view with all widgets visible

---

### Step 2: Verify RPC Calls (1 minute)

**Action**: Open Network tab → Filter by "RPC" → Reload page

**Expected Results**:
- ✅ `get_dashboard_stats` called with `p_date_from` and `p_date_to` (not `p_days`)
- ✅ `get_dashboard_timeline` called with date range
- ✅ `get_dashboard_intents` called with date range
- ✅ `get_dashboard_breakdown` called (for each dimension)
- ✅ All RPC calls return 200 status
- ✅ All responses are JSON (not errors)

**Screenshot**: `02_network_rpc_calls.png`
- Capture: Network tab showing all RPC calls with 200 status

**Verify in Console**:
```javascript
// Check RPC calls in Network tab
// Should see:
// - get_dashboard_stats (POST)
// - get_dashboard_timeline (POST)
// - get_dashboard_intents (POST)
// - get_dashboard_breakdown (POST) - multiple times
```

---

### Step 3: Test Date Range Picker (1 minute)

**Action**: 
1. Click date range picker in header
2. Select "Last 7 Days"
3. Select "Last 30 Days"
4. Select custom range (e.g., Jan 1 - Jan 15)

**Expected Results**:
- ✅ Date range picker opens/closes smoothly
- ✅ URL updates with `?from=...&to=...` parameters
- ✅ Dashboard data refreshes when range changes
- ✅ All widgets update (KPIs, Timeline, Intents, Breakdown)
- ✅ No console errors

**Screenshot**: `03_date_range_picker.png`
- Capture: Date range picker open with options visible

**Verify URL**: Should contain `?from=2026-01-21T00:00:00.000Z&to=2026-01-28T23:59:59.999Z` format

---

### Step 4: Test 6-Month Max Range Validation (30 seconds)

**Action**: 
1. Open date range picker
2. Try to select a range > 6 months (e.g., Jan 1, 2025 to Jan 28, 2026)

**Expected Results**:
- ✅ Error message displayed: "Date range exceeds maximum of 180 days (6 months)"
- ✅ Range selection rejected
- ✅ Dashboard remains on previous valid range

**Screenshot**: `04_range_validation_error.png`
- Capture: Error message displayed in UI

---

### Step 5: Verify Timeline Chart (1 minute)

**Action**: 
1. Observe timeline chart
2. Hover over data points
3. Check chart legend

**Expected Results**:
- ✅ Chart displays time series data
- ✅ Multiple metrics visible (visitors, events, calls, intents, conversions)
- ✅ Tooltip shows values on hover
- ✅ Chart updates when date range changes
- ✅ No heartbeat events visible (chart should be clean)

**Screenshot**: `05_timeline_chart.png`
- Capture: Timeline chart with data points visible

**Verify**: Check that chart data matches RPC response from Network tab

---

### Step 6: Test Intent Ledger (1 minute)

**Action**:
1. Scroll to Intent Ledger section
2. Click status filter buttons (Pending, Sealed, Junk, Suspicious)
3. Use search box to filter by page URL
4. Click on an intent row to open Session Drawer

**Expected Results**:
- ✅ Intent Ledger displays intents (calls + conversions)
- ✅ Status filters work (counts update)
- ✅ Search filters by page URL
- ✅ Session Drawer opens on click
- ✅ Session details display correctly

**Screenshot**: `06_intent_ledger.png`
- Capture: Intent Ledger with filters and search visible

**Screenshot**: `07_session_drawer.png`
- Capture: Session Drawer open with session details

---

### Step 7: Test Breakdown Widget (30 seconds)

**Action**:
1. Scroll to Breakdown Widget in side panel
2. Switch between dimensions (Source, Device, City)
3. Observe percentage calculations

**Expected Results**:
- ✅ Breakdown Widget displays data
- ✅ Dimension selector works (Source/Device/City)
- ✅ Percentages sum to 100% (or close)
- ✅ Counts match total sessions

**Screenshot**: `08_breakdown_widget.png`
- Capture: Breakdown Widget showing source breakdown with percentages

---

### Step 8: Test Realtime Updates (1 minute)

**Action**:
1. Open another browser tab/window
2. Navigate to test page: `/test-page`
3. Trigger an event (click phone link, scroll, etc.)
4. Return to dashboard tab

**Expected Results**:
- ✅ Realtime Pulse indicator shows "Live" status
- ✅ KPI cards update (visitors, events increase)
- ✅ Intent Ledger updates (new intents appear)
- ✅ Timeline chart does NOT redraw on every event (bounded refresh)
- ✅ No duplicate events processed (deduplication working)

**Screenshot**: `09_realtime_updates.png`
- Capture: Dashboard showing updated KPIs after realtime event

**Verify in Console**:
```javascript
// Check for deduplication logs (if enabled)
// Should see event IDs logged
// Same event ID should not appear twice
```

---

### Step 9: Verify Site Isolation (30 seconds)

**Action**:
1. If you have access to multiple sites, switch between sites
2. Verify data changes correctly

**Expected Results**:
- ✅ Each site shows only its own data
- ✅ No cross-site data leakage
- ✅ Site switcher works correctly

**Screenshot**: `10_site_isolation.png`
- Capture: Dashboard showing different data for different sites

---

### Step 10: Error Handling (30 seconds)

**Action**:
1. Disconnect network (or block Supabase API)
2. Try to refresh dashboard
3. Reconnect network
4. Click "Retry" button

**Expected Results**:
- ✅ Error state displayed clearly
- ✅ Retry button works
- ✅ Dashboard recovers after reconnection

**Screenshot**: `11_error_handling.png`
- Capture: Error state with retry button visible

---

## Post-Test Checklist

- [ ] All screenshots captured
- [ ] No console errors
- [ ] All RPC calls successful (200 status)
- [ ] Date range picker works
- [ ] 6-month validation works
- [ ] Timeline chart displays correctly
- [ ] Intent Ledger filters work
- [ ] Breakdown Widget displays correctly
- [ ] Realtime updates work
- [ ] Site isolation verified

---

## Expected Screenshots

1. `01_dashboard_loaded.png` - Full dashboard view
2. `02_network_rpc_calls.png` - Network tab with RPC calls
3. `03_date_range_picker.png` - Date range picker open
4. `04_range_validation_error.png` - 6-month validation error
5. `05_timeline_chart.png` - Timeline chart with data
6. `06_intent_ledger.png` - Intent Ledger with filters
7. `07_session_drawer.png` - Session Drawer open
8. `08_breakdown_widget.png` - Breakdown Widget
9. `09_realtime_updates.png` - Realtime updates visible
10. `10_site_isolation.png` - Site switching
11. `11_error_handling.png` - Error state

---

## Acceptance Criteria

| Test | Status | Evidence |
|------|--------|----------|
| Dashboard loads | ✅/❌ | Screenshot 01 |
| RPC calls use date_from/date_to | ✅/❌ | Screenshot 02 |
| Date range picker works | ✅/❌ | Screenshot 03 |
| 6-month validation works | ✅/❌ | Screenshot 04 |
| Timeline chart displays | ✅/❌ | Screenshot 05 |
| Intent Ledger works | ✅/❌ | Screenshots 06, 07 |
| Breakdown Widget works | ✅/❌ | Screenshot 08 |
| Realtime updates work | ✅/❌ | Screenshot 09 |
| Site isolation verified | ✅/❌ | Screenshot 10 |
| Error handling works | ✅/❌ | Screenshot 11 |

---

**Date**: 2026-01-28  
**Tester**: [Your Name]  
**Environment**: [Production/Staging/Development]

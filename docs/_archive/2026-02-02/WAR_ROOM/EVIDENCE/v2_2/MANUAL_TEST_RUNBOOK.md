# Manual Test Runbook - v2.2 (5-10 mins)

**Target**: `/dashboard/site/[siteId]`

## Steps

1. **Load Dashboard** (30s)
   - Navigate to `/dashboard/site/[siteId]`
   - ✅ KPIs, Timeline, Intent Ledger, Breakdown visible
   - 📸 Screenshot: Full dashboard

2. **Verify RPC Calls** (1min)
   - Network tab → Filter "RPC" → Reload
   - ✅ `get_dashboard_stats` uses `p_date_from`/`p_date_to` (not `p_days`)
   - ✅ All RPCs return 200
   - 📸 Screenshot: Network tab with RPC calls

3. **Test Date Range** (1min)
   - Click date picker → Select "Last 7 Days"
   - ✅ URL updates with `?from=...&to=...`
   - ✅ All widgets refresh
   - 📸 Screenshot: Date picker open

4. **Test 6-Month Validation** (30s)
   - Try range > 6 months
   - ✅ Error: "Date range exceeds maximum of 180 days"
   - 📸 Screenshot: Error message

5. **Verify Timeline** (1min)
   - Check chart displays data
   - ✅ No heartbeat events visible
   - ✅ Chart updates on range change
   - 📸 Screenshot: Timeline chart

6. **Test Intent Ledger** (1min)
   - Filter by status (Pending/Sealed)
   - Search by page URL
   - Click intent → Session Drawer opens
   - 📸 Screenshot: Intent Ledger + Drawer

7. **Test Breakdown** (30s)
   - Switch dimensions (Source/Device/City)
   - ✅ Percentages calculated
   - 📸 Screenshot: Breakdown widget

8. **Test Realtime** (1min)
   - Open `/test-page` in new tab
   - Trigger event (click phone link)
   - ✅ KPIs update, chart does NOT redraw per event
   - 📸 Screenshot: Updated dashboard

## Expected Screenshots (8 total)
1. Full dashboard
2. Network RPC calls
3. Date picker
4. Range validation error
5. Timeline chart
6. Intent Ledger
7. Breakdown widget
8. Realtime updates

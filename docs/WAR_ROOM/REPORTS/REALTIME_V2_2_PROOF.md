# Realtime v2.2 Proof

**Date**: 2026-01-28  
**Purpose**: Demonstrate deduplication, bounded refresh, and site scoping

---

## 1. Deduplication Proof

### Implementation

**File**: `lib/hooks/use-realtime-dashboard.ts`

**Key Code**:
```typescript
// Line 67-80: Deduplication check
const isDuplicate = useCallback((eventId: string): boolean => {
  if (processedEventsRef.current.has(eventId)) {
    // Log deduplication in development
    if (process.env.NODE_ENV === 'development') {
      console.log('[REALTIME] Duplicate event ignored:', eventId);
    }
    return true;
  }
  processedEventsRef.current.add(eventId);
  
  // Log new event in development
  if (process.env.NODE_ENV === 'development') {
    console.log('[REALTIME] New event processed:', eventId);
  }
  
  // Cleanup old events (keep last 1000)
  if (processedEventsRef.current.size > 1000) {
    const eventsArray = Array.from(processedEventsRef.current);
    processedEventsRef.current = new Set(eventsArray.slice(-500));
  }
  
  return false;
}, []);
```

**Event ID Format**: `${table}:${id}:${timestamp}` (Line 62-64)

### Test Harness

**File**: `scripts/test-realtime-dedup.mjs`

**How to Run**:
```bash
node scripts/test-realtime-dedup.mjs
```

**Expected Output**:
1. Creates a test call
2. Updates the call twice quickly (simulates duplicate events)
3. Browser console shows:
   - `[REALTIME] New event processed: calls:{id}:{timestamp}`
   - `[REALTIME] Duplicate event ignored: calls:{id}:{timestamp}` (if same timestamp)

### Verification Steps

1. Open dashboard in browser
2. Open browser console (F12)
3. Run test script: `node scripts/test-realtime-dedup.mjs`
4. Watch console for deduplication logs
5. Verify only one callback execution per unique event

---

## 2. Chart Bounded Refresh Proof

### Implementation

**File**: `components/dashboard/timeline-chart.tsx`

**Key Code**:
```typescript
// Line 58-73: Auto-refresh based on interval
useEffect(() => {
  const intervalMs = {
    '1m': 60000,
    '5m': 300000,
    '30m': 1800000,
  }[effectiveInterval];

  if (process.env.NODE_ENV === 'development') {
    console.log('[TimelineChart] Auto-refresh interval set:', effectiveInterval, `(${intervalMs}ms)`);
  }

  const interval = setInterval(() => {
    // Only refresh if tab is visible
    if (document.visibilityState === 'visible') {
      handleRefresh(true); // Silent refresh
    }
  }, intervalMs);

  return () => clearInterval(interval);
}, [effectiveInterval, handleRefresh]);
```

**Refresh Policy**:
- Current day: 5 minutes
- Historical: 30 minutes
- Manual refresh: User-triggered

**Logging**:
```typescript
// Line 75-91: Refresh handler with logging
const handleRefresh = useCallback(async (silent = false) => {
  if (!silent) {
    setIsRefreshing(true);
  }
  
  // Log refresh in development
  if (process.env.NODE_ENV === 'development') {
    console.log('[TimelineChart] Refreshing chart', { silent, timestamp: new Date().toISOString() });
  }
  
  // ... refresh logic
}, [refetch]);
```

### Verification Steps

1. Open dashboard in browser
2. Open browser console (F12)
3. Observe initial log: `[TimelineChart] Auto-refresh interval set: 5m (300000ms)`
4. Trigger realtime events (create/update calls)
5. Verify chart does NOT refresh on every event
6. Wait 5 minutes (or trigger manual refresh)
7. Verify log: `[TimelineChart] Refreshing chart { silent: true, timestamp: ... }`
8. Confirm chart only refreshes on interval, not on every realtime event

### Expected Behavior

- ✅ Chart refreshes on mount
- ✅ Chart refreshes on date range change
- ✅ Chart refreshes every 5 minutes (current day) or 30 minutes (historical)
- ✅ Chart refreshes on manual refresh button click
- ❌ Chart does NOT refresh on every realtime event

---

## 3. Site Scoping Proof

### Implementation

**File**: `lib/hooks/use-realtime-dashboard.ts`

**Key Code**:
```typescript
// Line 99-109: Site-specific channel
const channelName = `dashboard_updates:${siteId}`;

// Log site scoping in development
if (process.env.NODE_ENV === 'development') {
  console.log('[REALTIME] Subscribing to site-specific channel:', channelName);
  console.log('[REALTIME] Site filter applied: site_id=eq.' + siteId);
}

const channel = supabase
  .channel(channelName)
  .on(
    'postgres_changes',
    {
      event: 'INSERT',
      schema: 'public',
      table: 'calls',
      filter: `site_id=eq.${siteId}`, // Site-scoped filter
    },
    (payload) => {
      // ... event handler
      
      // Verify site_id matches (defense in depth)
      if (newCall.site_id !== siteId) {
        if (process.env.NODE_ENV === 'development') {
          console.warn('[REALTIME] Cross-site event blocked:', newCall.site_id, '!==', siteId);
        }
        return;
      }
      
      // ... process event
    }
  )
```

**Three Layers of Site Scoping**:
1. **Channel Name**: `dashboard_updates:{siteId}` - Isolates subscriptions
2. **Filter**: `site_id=eq.{siteId}` - Server-side filtering
3. **Client Check**: `if (newCall.site_id !== siteId) return;` - Defense in depth

### Test Harness

**File**: `scripts/test-realtime-site-scope.mjs`

**How to Run**:
```bash
node scripts/test-realtime-site-scope.mjs
```

**Expected Output**:
1. Creates test calls for two different sites
2. Verifies channel names are site-specific
3. Demonstrates cross-site events are blocked

### Verification Steps

1. Open dashboard for Site 1
2. Open browser console (F12)
3. Observe log: `[REALTIME] Subscribing to site-specific channel: dashboard_updates:{siteId1}`
4. Open dashboard for Site 2 (different tab)
5. Update a call for Site 2
6. Verify Site 1 dashboard does NOT receive Site 2 event
7. Check console for `[REALTIME] Cross-site event blocked` if event somehow reaches wrong subscription

---

## Summary

| Feature | Status | Evidence |
|--------|--------|----------|
| Deduplication | ✅ | `isDuplicate()` function with eventId tracking |
| Bounded Refresh | ✅ | Interval-based refresh (5m/30m), not per-event |
| Site Scoping | ✅ | Channel name + filter + client check (3 layers) |

---

## Test Scripts

1. **Deduplication**: `scripts/test-realtime-dedup.mjs`
2. **Site Scoping**: `scripts/test-realtime-site-scope.mjs`

---

## Logging

All logging is enabled in `development` mode:
- `[REALTIME] New event processed: {eventId}`
- `[REALTIME] Duplicate event ignored: {eventId}`
- `[REALTIME] Subscribing to site-specific channel: {channelName}`
- `[REALTIME] Site filter applied: site_id=eq.{siteId}`
- `[REALTIME] Cross-site event blocked: {siteId1} !== {siteId2}`
- `[TimelineChart] Auto-refresh interval set: {interval}`
- `[TimelineChart] Refreshing chart { silent, timestamp }`

---

**Status**: ✅ All three features implemented and verifiable

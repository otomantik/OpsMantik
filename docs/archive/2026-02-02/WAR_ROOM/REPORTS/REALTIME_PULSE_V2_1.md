# Realtime Pulse v2.1 - Strict Scope + Idempotent Optimistic

**Date**: 2026-01-28  
**Purpose**: Implement centralized realtime dashboard updates with strict scope and idempotent optimistic updates for PRO Dashboard Migration v2.1  
**Status**: Implementation Complete

---

## Executive Summary

Phase 7 implements a centralized realtime hook (`useRealtimeDashboard`) that provides:
- **Strict Scope**: Site-specific subscriptions only
- **Idempotent Updates**: Event deduplication prevents duplicate processing
- **Optimistic Updates**: Immediate UI updates for KPIs (not charts)
- **Connection Status**: Real-time connection monitoring
- **Event Types**: Typed events for different dashboard updates

---

## Architecture

### Realtime Strategy

**Policy**:
1. **Strict Scope**: Only subscribe to events for the current `siteId`
2. **Idempotent**: Deduplication using event ID (table:id:timestamp)
3. **Optimistic**: Update KPIs immediately, charts use bounded refresh (Phase 5)
4. **Connection Tracking**: Monitor subscription status
5. **Event Queue**: Process events in order with deduplication

**Rationale**: 
- Prevents cross-site data leakage
- Eliminates duplicate event processing
- Provides instant feedback for KPIs
- Charts remain stable with bounded refresh

---

## Implementation

### Hook: `useRealtimeDashboard`

**Location**: `lib/hooks/use-realtime-dashboard.ts`

**Features**:
- Site-specific channel subscription
- Event deduplication (last 1000 events tracked)
- Connection status tracking
- Typed event callbacks
- Automatic cleanup on unmount

**Event Types**:
```typescript
type DashboardEvent =
  | { type: 'intent_created'; data: IntentRow }
  | { type: 'intent_updated'; data: Partial<IntentRow> & { id: string } }
  | { type: 'session_heartbeat'; data: { session_id: string; site_id: string } }
  | { type: 'conversion_sealed'; data: { intent_id: string; sealed_at: Date } }
  | { type: 'data_freshness'; data: { last_event_at: Date } }
  | { type: 'call_created'; data: any }
  | { type: 'call_updated'; data: Partial<any> & { id: string } }
  | { type: 'event_created'; data: any }
```

**State**:
```typescript
interface RealtimeDashboardState {
  isConnected: boolean;
  lastEventAt: Date | null;
  eventCount: number;
  error: string | null;
}
```

**Callbacks**:
```typescript
interface RealtimeDashboardCallbacks {
  onIntentCreated?: (intent: IntentRow) => void;
  onIntentUpdated?: (intent: Partial<IntentRow> & { id: string }) => void;
  onCallCreated?: (call: any) => void;
  onCallUpdated?: (call: Partial<any> & { id: string }) => void;
  onEventCreated?: (event: any) => void;
  onDataFreshness?: (lastEventAt: Date) => void;
}
```

---

### Deduplication Mechanism

**Event ID Generation**:
```typescript
const generateEventId = (table: string, id: string, timestamp: string): string => {
  return `${table}:${id}:${timestamp}`;
};
```

**Deduplication Check**:
- Tracks last 1000 processed events
- Automatically cleans up old events (keeps last 500)
- Prevents duplicate processing of same event

**Why This Works**:
- Supabase realtime may deliver same event multiple times
- Database triggers may fire multiple times
- Network retries can cause duplicates
- Event ID combines table, record ID, and commit timestamp for uniqueness

---

### Component: `RealtimePulse`

**Location**: `components/dashboard/realtime-pulse.tsx`

**Features**:
- Connection status indicator (Live/Offline)
- Last event timestamp
- Event count badge
- Error display

**Visual States**:
- **Connected**: Green WiFi icon with pulse animation
- **Disconnected**: Gray WiFi-off icon
- **Error**: Red error message

---

## Integration

### Dashboard Layout

**File**: `components/dashboard/dashboard-layout.tsx`

**Changes**:
- Added `useRealtimeDashboard` hook
- Displays `RealtimePulse` in header
- Passes callbacks for data freshness updates

### StatsCards

**File**: `components/dashboard/stats-cards.tsx`

**Changes**:
- Added `useRealtimeDashboard` hook
- Optimistic refresh on event/call creation
- **Note**: Only KPIs refresh, charts use bounded refresh (Phase 5)

### IntentLedger

**File**: `components/dashboard/intent-ledger.tsx`

**Changes**:
- Added `useRealtimeDashboard` hook
- Optimistic refresh on call created/updated
- Maintains filter and search state during refresh

---

## Subscription Details

### Channel Name

**Format**: `dashboard_updates:${siteId}`

**Example**: `dashboard_updates:550e8400-e29b-41d4-a716-446655440000`

**Why Site-Specific**:
- Prevents cross-site data leakage
- Reduces subscription overhead
- Enables per-site connection monitoring

### Subscribed Tables

1. **calls** (INSERT, UPDATE)
   - Filter: `site_id=eq.${siteId}`
   - Events: `call_created`, `call_updated`

2. **events** (INSERT)
   - Filter: Verified via session join (site_id check)
   - Events: `event_created`, `data_freshness`

---

## Optimistic Update Strategy

### KPIs (StatsCards)

**Policy**: Immediate refresh on realtime events
- New event → Refresh stats immediately
- New call → Refresh stats immediately
- Data freshness → Update last_event_at

**Rationale**: KPIs are lightweight queries, instant feedback improves UX

### Charts (TimelineChart)

**Policy**: Bounded refresh (Phase 5)
- **NOT** refreshed on realtime events
- Uses interval-based refresh (5m/30m)
- Prevents CPU spikes and layout thrashing

**Rationale**: Charts are expensive to render, bounded refresh maintains performance

### Intent Ledger

**Policy**: Optimistic refresh on call changes
- New call → Refresh intents list
- Call updated → Refresh intents list
- Maintains filter/search state

**Rationale**: Intent list is lightweight, real-time updates improve workflow

---

## Connection Status

### States

1. **SUBSCRIBED**: Connected and receiving events
2. **CHANNEL_ERROR**: Connection error occurred
3. **TIMED_OUT**: Connection timeout
4. **CLOSED**: Connection closed

### Reconnection

**Automatic**: Supabase client handles reconnection automatically

**Manual**: `reconnect()` function available for manual reconnection

---

## Performance Considerations

### Memory Management

**Event Tracking**:
- Tracks last 1000 processed events
- Automatically cleans up to last 500 when limit reached
- Prevents memory leaks from long-running sessions

### Subscription Overhead

**Per-Site Channel**:
- One subscription per site
- Minimal overhead (Supabase handles efficiently)
- Automatic cleanup on unmount

### Event Processing

**Async Verification**:
- Events table subscription verifies site_id via session join
- Prevents processing events from wrong site
- Adds small latency but ensures correctness

---

## Security

### Site Isolation

**Strict Filtering**:
- Calls: Filtered by `site_id=eq.${siteId}` at subscription level
- Events: Verified via session join before processing
- Prevents cross-site data leakage

### RLS Compliance

**Client-Side Verification**:
- Additional site_id check for events (defense in depth)
- RLS policies provide database-level protection
- Client-side verification adds extra layer

---

## Files Created

1. `lib/hooks/use-realtime-dashboard.ts` - Centralized realtime hook
2. `components/dashboard/realtime-pulse.tsx` - Connection status indicator

## Files Modified

1. `components/dashboard/dashboard-layout.tsx` - Added RealtimePulse
2. `components/dashboard/stats-cards.tsx` - Added optimistic updates
3. `components/dashboard/intent-ledger.tsx` - Added optimistic updates

---

## Future Enhancements

### Event Batching

**Current**: Process events one at a time
**Future**: Batch events and process together (reduce re-renders)

### Offline Queue

**Current**: Events lost if offline
**Future**: Queue events when offline, process when reconnected

### Event History

**Current**: Only tracks last 1000 events for deduplication
**Future**: Maintain event history for debugging/audit

### Metrics

**Current**: Basic event count
**Future**: Track event types, processing time, errors

---

## Testing Checklist

- [ ] Realtime connection establishes on mount
- [ ] Connection status displays correctly (Live/Offline)
- [ ] Events are deduplicated correctly
- [ ] Site-specific filtering works (no cross-site events)
- [ ] KPIs refresh optimistically on events
- [ ] Charts do NOT refresh on realtime events (bounded refresh)
- [ ] Intent Ledger refreshes on call changes
- [ ] Connection reconnects automatically after disconnect
- [ ] Cleanup works correctly on unmount
- [ ] Error states display correctly
- [ ] Event count increments correctly
- [ ] Last event timestamp updates correctly

---

## Next Steps

1. **Add Event Batching**: Process multiple events together
2. **Add Offline Queue**: Queue events when offline
3. **Add Metrics**: Track event processing performance
4. **Add Event History**: Maintain event log for debugging
5. **Add Reconnection UI**: Show reconnection status to user

---

**Status**: ✅ Phase 7 Complete - Realtime Pulse with Strict Scope and Idempotent Optimistic Updates Implemented

**Note**: Current implementation processes events individually. Event batching recommended for high-volume scenarios.

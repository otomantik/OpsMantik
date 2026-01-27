# Timeline Chart v2.1 - Bounded Refresh Strategy

**Date**: 2026-01-28  
**Purpose**: Implement timeline chart with bounded refresh strategy for PRO Dashboard Migration v2.1  
**Status**: Implementation Complete

---

## Executive Summary

Phase 5 implements a timeline chart component with intelligent refresh strategy:
- Auto-granularity based on date range (hourly/day/weekly)
- Bounded refresh intervals (5m for current day, 30m for historical)
- Manual refresh capability
- Optimistic updates for KPIs, NOT for charts (prevents CPU spikes)
- SVG-based chart (no external dependencies, recharts recommended for production)

---

## Architecture

### Refresh Strategy

**Policy**:
1. **Initial Load**: On mount + date range change
2. **Realtime Updates**: Optimistic for KPI, NOT for chart
3. **Interval Refresh**: 
   - Current day: Every 5 minutes
   - Historical: Every 30 minutes
4. **Manual Refresh**: User-triggered via button
5. **Visibility Check**: Only refresh when tab is visible

**Rationale**: Charts are expensive to render. Real-time updates cause:
- CPU spikes
- Layout thrashing
- Poor mobile performance

**Solution**: Show "Data updating..." badge when new data available, but don't auto-refresh chart on every realtime event.

---

## Implementation

### Hook: `useTimelineData`

**Location**: `lib/hooks/use-timeline-data.ts`

**Features**:
- Fetches sessions, events, and calls for date range
- Auto-granularity calculation:
  - < 7 days: hourly
  - 7-30 days: daily
  - > 30 days: weekly
- Aggregates data by time bucket
- Partition-aware queries (month filtering)

**Data Structure**:
```typescript
interface TimelinePoint {
  date: string; // ISO date string
  label: string; // Formatted label (TRT)
  visitors: number; // Unique visitors (by fingerprint)
  events: number; // Total events
  calls: number; // Total calls
  intents: number; // Calls with status='intent'
  conversions: number; // Confirmed calls + conversion events
}
```

---

### Component: `TimelineChart`

**Location**: `components/dashboard/timeline-chart.tsx`

**Features**:
- SVG-based chart (no external dependencies)
- Three data series: Visitors (blue), Events (green), Calls (purple)
- Auto-refresh based on date range (5m/30m)
- Manual refresh button
- Loading and error states
- Last updated timestamp
- Refresh interval indicator

**Refresh Logic**:
```typescript
// Determine interval based on date range
const isCurrentDay = rangeDays <= 1 && 
  dateRange.to.toDateString() === new Date().toDateString();

const effectiveInterval = isCurrentDay ? '5m' : '30m';
```

**Auto-Refresh**:
- Only refreshes when tab is visible (`document.visibilityState === 'visible'`)
- Silent refresh (no loading spinner) for background updates
- Manual refresh shows loading state

---

## Chart Visualization

### Current Implementation: SVG

**Pros**:
- No external dependencies
- Lightweight
- Works immediately

**Cons**:
- Limited interactivity
- Basic tooltips
- Manual scaling logic

### Recommended: Recharts

**Installation**:
```bash
npm install recharts
npm install --save-dev @types/recharts
```

**Benefits**:
- Rich interactivity (tooltips, zoom, pan)
- Better performance for large datasets
- Professional appearance
- Built-in responsive design

**Migration Path**:
1. Install recharts
2. Replace SVG chart with `AreaChart` from recharts
3. Keep refresh strategy unchanged

---

## Integration

### Dashboard Layout

**File**: `components/dashboard/dashboard-layout.tsx`

**Changes**:
- Added TimelineChart component
- Positioned between KPI cards and main activity layout
- Passes `siteId` and `dateRange` from URL state

**Layout Structure**:
```
Row 1: KPI Cards
Row 2: Timeline Chart (NEW)
Row 3: Call Monitor + Live Feed (Main column) | Side Panels
```

---

## Performance Considerations

### Query Optimization

**Current**:
- Fetches all sessions, events, calls for date range
- Client-side aggregation
- May be slow for large date ranges

**Recommended** (Future):
- Create RPC function `get_dashboard_timeline()`
- Server-side aggregation by time bucket
- Returns pre-aggregated data points
- Much faster for large datasets

### Rendering Optimization

**Current**:
- SVG chart renders all points
- May be slow for > 1000 points

**Future Enhancements**:
- Data sampling for large ranges
- Virtual scrolling for X-axis
- Canvas-based rendering for > 1000 points

---

## Refresh Strategy Details

### Interval Selection

| Date Range | Interval | Reason |
|------------|----------|--------|
| Current day | 5 minutes | High activity, frequent updates needed |
| Historical | 30 minutes | Lower activity, less frequent updates sufficient |

### Visibility Check

**Implementation**:
```typescript
if (document.visibilityState === 'visible') {
  handleRefresh(true); // Silent refresh
}
```

**Benefit**: Prevents unnecessary refreshes when tab is hidden, saving resources.

---

## Files Created

1. `lib/hooks/use-timeline-data.ts` - Timeline data fetching hook
2. `components/dashboard/timeline-chart.tsx` - Timeline chart component

## Files Modified

1. `components/dashboard/dashboard-layout.tsx` - Added TimelineChart

---

## Future Enhancements

### RPC Function

**Create**: `get_dashboard_timeline(p_site_id, p_from, p_to, p_granularity)`

**Returns**: Pre-aggregated timeline points
- Faster than client-side aggregation
- Better for large date ranges
- Consistent with other RPC functions

### Chart Library Migration

**Install recharts**:
```bash
npm install recharts
```

**Replace SVG with AreaChart**:
- Better tooltips
- Zoom/pan support
- Professional appearance

### Additional Features

- **Export**: Download chart as PNG/CSV
- **Comparison**: Compare with previous period
- **Annotations**: Mark important events
- **Drill-down**: Click point to see details

---

## Testing Checklist

- [ ] Chart loads on mount
- [ ] Chart refreshes on date range change
- [ ] Auto-refresh works (5m for current day, 30m for historical)
- [ ] Manual refresh button works
- [ ] Refresh only when tab visible
- [ ] Loading state displays correctly
- [ ] Error state displays correctly
- [ ] Empty state displays correctly
- [ ] Chart scales correctly for different data ranges
- [ ] Mobile responsive

---

## Next Steps

1. **Install Recharts**: For better chart visualization
2. **Create RPC Function**: `get_dashboard_timeline()` for server-side aggregation
3. **Add Tooltips**: Interactive data points
4. **Add Export**: Download chart data
5. **Performance Testing**: Test with large date ranges

---

**Status**: ✅ Phase 5 Complete - Timeline Chart with Bounded Refresh Strategy Implemented

**Note**: Current implementation uses SVG. Recharts recommended for production use.

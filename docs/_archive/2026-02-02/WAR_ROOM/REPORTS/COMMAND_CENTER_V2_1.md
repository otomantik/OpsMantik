# Command Center v2.1 - Phase 3: URL-State Management

**Date**: 2026-01-28  
**Purpose**: Implement URL-state managed dashboard layout for PRO Dashboard Migration v2.1  
**Status**: Implementation Complete

---

## Executive Summary

Phase 3 implements URL-state management for the dashboard, enabling:
- Date range selection via URL params
- UTC storage in URL, TRT display in UI
- Max 6 months range enforcement
- Preset date ranges (Bugün, Dün, 7d, 30d, Bu Ay)
- Health indicator integration

---

## Architecture

### URL-State Contract

**Storage Format**: UTC ISO strings in URL params
- `?from=2026-01-21T00:00:00.000Z&to=2026-01-28T23:59:59.999Z`

**Display Format**: TRT (Europe/Istanbul) in UI
- `21.01.2026 - 28.01.2026 (TRT)`

**Normalization**: UTC at API boundary
- Dates normalized to UTC before sending to RPC functions
- UI displays in TRT for user-friendly experience

**Max Range**: 6 months (180 days)
- Enforced in hook validation
- Prevents excessive query ranges

---

## Implementation

### Hook: `useDashboardDateRange`

**Location**: `lib/hooks/use-dashboard-date-range.ts`

**Features**:
- Reads `from` and `to` from URL search params
- Defaults to last 7 days if not provided
- Validates date range (max 180 days)
- Provides presets and `applyPreset` function
- Updates URL when range changes

**Usage**:
```typescript
const { range, presets, updateRange, applyPreset } = useDashboardDateRange(siteId);

// range.from and range.to are Date objects (UTC normalized)
// presets: [{ label: 'Bugün', value: 'today' }, ...]
// updateRange({ from: Date, to: Date }) - updates URL
// applyPreset('today') - applies preset and updates URL
```

---

### Component: `DashboardLayout`

**Location**: `components/dashboard/dashboard-layout.tsx`

**Features**:
- Command center header with date picker and health indicator
- Grid layout: KPI cards → Charts → Intent ledger
- Integrates existing components (StatsCards, LiveFeed, CallAlertWrapper, etc.)
- Dark theme maintained (bg-[#020617])

**Props**:
- `siteId` - Site UUID
- `siteName` - Optional site name
- `siteDomain` - Optional site domain
- `initialHealth` - Optional health status

---

### Component: `DateRangePicker`

**Location**: `components/dashboard/date-range-picker.tsx`

**Features**:
- Dropdown with presets and custom range (placeholder)
- Displays current range in TRT format
- Shows max range limit (180 days)
- Dark theme styling

**Props**:
- `value` - Current date range
- `onSelect` - Callback for custom range selection
- `onPresetSelect` - Callback for preset selection
- `presets` - Array of preset options
- `timezone` - Display timezone (default: Europe/Istanbul)
- `maxRange` - Max days allowed (default: 180)

---

### Component: `HealthIndicator`

**Location**: `components/dashboard/health-indicator.tsx`

**Features**:
- Displays dashboard health status
- Shows data latency in relative time (TRT)
- Color-coded status (healthy/degraded/critical)
- Icon indicators

**Props**:
- `health` - DashboardHealth object with:
  - `data_latency` - ISO timestamp
  - `completeness` - 0-1 value
  - `last_sync` - ISO timestamp or null
  - `status` - 'healthy' | 'degraded' | 'critical'

---

## Integration

### Page Component Update

**File**: `app/dashboard/site/[siteId]/page.tsx`

**Changes**:
- Replaced inline layout with `DashboardLayout` component
- Passes site info and default health to layout
- Maintains server-side access validation

**Before**:
```typescript
return (
  <div className="min-h-screen bg-[#020617] relative">
    {/* Inline layout code */}
  </div>
);
```

**After**:
```typescript
return (
  <DashboardLayout
    siteId={siteId}
    siteName={site.name || undefined}
    siteDomain={site.domain || undefined}
    initialHealth={defaultHealth}
  />
);
```

---

## Date Range Presets

| Preset | Label | Range |
|--------|-------|-------|
| `today` | Bugün | Today 00:00 - 23:59 TRT |
| `yesterday` | Dün | Yesterday 00:00 - 23:59 TRT |
| `7d` | Son 7 Gün | Last 7 days from today |
| `30d` | Son 30 Gün | Last 30 days from today |
| `month` | Bu Ay | First day of current month - today |

**Note**: All presets use TRT timezone for user display, but store UTC in URL.

---

## URL Format Examples

### Default (No Params)
```
/dashboard/site/[siteId]
→ Uses last 7 days (calculated client-side)
```

### With Date Range
```
/dashboard/site/[siteId]?from=2026-01-21T00:00:00.000Z&to=2026-01-28T23:59:59.999Z
→ Displays: 21.01.2026 - 28.01.2026 (TRT)
```

### With Preset Applied
```
/dashboard/site/[siteId]?from=2026-01-28T00:00:00.000Z&to=2026-01-28T23:59:59.999Z
→ "Bugün" preset applied
```

---

## Future Enhancements

### Custom Date Range Picker
- Currently shows placeholder
- Should integrate date picker library (e.g., react-day-picker)
- Allow manual date selection

### Health Check Integration
- Connect to actual health monitoring
- Calculate data latency from last sync
- Determine completeness from data gaps

### RPC Integration
- Pass date range to RPC functions
- Normalize dates to UTC before API calls
- Update `useDashboardStats` to use date range from URL

---

## Files Created

1. `lib/hooks/use-dashboard-date-range.ts` - Date range hook
2. `components/dashboard/dashboard-layout.tsx` - Main layout component
3. `components/dashboard/date-range-picker.tsx` - Date picker component
4. `components/dashboard/health-indicator.tsx` - Health status component

## Files Modified

1. `app/dashboard/site/[siteId]/page.tsx` - Updated to use DashboardLayout

---

## Testing Checklist

- [ ] Date range persists in URL on page reload
- [ ] Presets apply correct date ranges
- [ ] Max 6 months range enforced
- [ ] Dates display in TRT format
- [ ] URL stores UTC ISO strings
- [ ] Health indicator shows correct status
- [ ] Date picker dropdown opens/closes correctly
- [ ] Mobile responsive layout

---

## Next Steps

1. **Integrate with RPC**: Update `useDashboardStats` to use date range from URL
2. **Custom Date Picker**: Implement full date picker UI
3. **Health Monitoring**: Connect to actual health check system
4. **Timeline Chart**: Create timeline chart component using date range
5. **Breakdown Widget**: Create breakdown widget component
6. **Intent Ledger**: Create intent ledger component

---

**Status**: ✅ Phase 3 Complete - URL-State Management Implemented

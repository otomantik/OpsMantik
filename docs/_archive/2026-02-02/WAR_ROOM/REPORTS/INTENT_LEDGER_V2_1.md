# Intent Ledger v2.1 - Lead Inbox with Session Drawer

**Date**: 2026-01-28  
**Purpose**: Implement Intent Ledger component with filtering, search, and session drawer for PRO Dashboard Migration v2.1  
**Status**: Implementation Complete

---

## Executive Summary

Phase 6 implements a comprehensive Intent Ledger (Lead Inbox) that displays all intents (calls + conversion events) in a table format with:
- Status filtering (pending/sealed/junk/suspicious)
- Search by page URL
- Session drawer for detailed view
- Status update via API
- Confidence score display

---

## Architecture

### Intent Definition

**Intents** include:
1. **Calls**: Phone/WhatsApp clicks with `status='intent'` or `null`
2. **Conversion Events**: Events with `event_category='conversion'`

**Status Mapping**:
- `pending`: `status='intent'` or `null` (awaiting action)
- `sealed`: `status IN ('confirmed', 'qualified', 'real')` (completed)
- `junk`: `status='junk'` (rejected)
- `suspicious`: `status='suspicious'` (flagged for review)

---

## Implementation

### Hook: `useIntents`

**Location**: `lib/hooks/use-intents.ts`

**Features**:
- Fetches calls with session join for site filtering
- Fetches conversion events with session join
- Combines and sorts by timestamp
- Partition-aware queries (month filtering)

**Data Structure**:
```typescript
interface IntentRow {
  id: string;
  type: 'call' | 'conversion';
  timestamp: string;
  status: IntentStatus;
  sealed_at: string | null;
  page_url: string;
  city: string | null;
  district: string | null;
  device_type: string | null;
  matched_session_id: string | null;
  confidence_score: number;
  phone_number?: string | null; // For calls
  event_category?: string; // For conversions
  event_action?: string; // For conversions
}
```

---

### Component: `IntentLedger`

**Location**: `components/dashboard/intent-ledger.tsx`

**Features**:
- Table view with sortable columns
- Status filter buttons with counts
- Search by page URL
- Click row to open session drawer
- Loading and error states
- Empty state with helpful message

**Filter Logic**:
```typescript
// Status filter mapping
pending: status === 'intent' || status === null
sealed: status IN ('confirmed', 'qualified', 'real')
junk: status === 'junk'
suspicious: status === 'suspicious'
```

**Table Columns**:
1. **Zaman**: Timestamp (HH:mm + date)
2. **Tür**: Call or Conversion badge
3. **Sayfa**: Page URL (pathname + full URL)
4. **Şehir/Cihaz**: City and device type
5. **Durum**: Status badge with sealed timestamp
6. **Güven**: Confidence score (lead_score for calls, event_value for conversions)
7. **Action**: "Görüşme Var" badge if matched_session_id exists

---

### Component: `SessionDrawer`

**Location**: `components/dashboard/session-drawer.tsx`

**Features**:
- Slide-in drawer panel (mobile: bottom, desktop: center)
- Session timeline using existing `SessionGroup` component
- Technical details (Session ID, IP, User Agent, Duration, Event count)
- Fetches session and events on open
- Loading and error states

**Layout**:
- Header with close button
- Session timeline (filtered to exclude heartbeats)
- Technical details grid

---

### Supporting Components

#### `IntentTypeBadge`
- **Location**: `components/dashboard/intent-type-badge.tsx`
- Displays call (Phone icon) or conversion (TrendingUp icon) badge

#### `IntentStatusBadge`
- **Location**: `components/dashboard/intent-status-badge.tsx`
- Displays status with icon:
  - **Kapanan** (green): confirmed/qualified/real
  - **Çöp** (gray): junk
  - **Şüpheli** (red): suspicious
  - **Bekleyen** (amber): pending
- Shows sealed timestamp if available

#### `ConfidenceScore`
- **Location**: `components/dashboard/confidence-score.tsx`
- Displays score with color coding:
  - >= 70: Orange
  - >= 40: Blue
  - < 40: Gray

---

## API Route

### `POST /api/intents/[id]/status`

**Location**: `app/api/intents/[id]/status/route.ts`

**Purpose**: Update intent (call) status

**Request**:
```json
{
  "status": "confirmed" | "qualified" | "real" | "junk" | "suspicious" | "intent" | null
}
```

**Response**:
```json
{
  "success": true,
  "call": { /* updated call object */ }
}
```

**Security**:
- Requires authentication
- Verifies user owns the site or is admin
- Validates status value

**Logic**:
- Sets `confirmed_at` if status is confirmed/qualified/real
- Clears `confirmed_at` for other statuses

---

## Integration

### Dashboard Layout

**File**: `components/dashboard/dashboard-layout.tsx`

**Position**: Row 3 (after Timeline Chart, before Main Activity Layout)

**Layout Structure**:
```
Row 1: KPI Cards
Row 2: Timeline Chart
Row 3: Intent Ledger (NEW)
Row 4: Call Monitor + Live Feed | Side Panels
```

---

## User Experience

### Filtering Flow

1. **Default**: Shows all intents
2. **Filter by Status**: Click status button (pending/sealed/junk/suspicious)
3. **Search**: Type in search box to filter by page URL
4. **Combined**: Filters work together (status + search)

### Session Drawer Flow

1. **Click Row**: Opens drawer with session details
2. **View Timeline**: See all session events (excluding heartbeats)
3. **View Details**: See technical information (ID, IP, User Agent, etc.)
4. **Close**: Click X or backdrop to close

### Status Update Flow

1. **Select Intent**: Click row to open drawer
2. **Update Status**: (Future: Add status dropdown in drawer)
3. **API Call**: POST to `/api/intents/[id]/status`
4. **Refresh**: Refetch intents to show updated status

---

## Performance Considerations

### Query Optimization

**Current**:
- Fetches all calls and conversions for date range
- Client-side filtering and search
- May be slow for large date ranges

**Recommended** (Future):
- Create RPC function `get_dashboard_intents(p_site_id, p_from, p_to, p_status, p_search)`
- Server-side filtering and search
- Pagination support
- Much faster for large datasets

### Rendering Optimization

**Current**:
- Renders all filtered intents in table
- May be slow for > 1000 intents

**Future Enhancements**:
- Virtual scrolling for table rows
- Pagination (50 per page)
- Infinite scroll

---

## Files Created

1. `lib/hooks/use-intents.ts` - Intent data fetching hook
2. `components/dashboard/intent-ledger.tsx` - Main Intent Ledger component
3. `components/dashboard/intent-type-badge.tsx` - Type badge component
4. `components/dashboard/intent-status-badge.tsx` - Status badge component
5. `components/dashboard/confidence-score.tsx` - Confidence score component
6. `components/dashboard/session-drawer.tsx` - Session drawer component
7. `app/api/intents/[id]/status/route.ts` - Status update API route

## Files Modified

1. `components/dashboard/dashboard-layout.tsx` - Added IntentLedger

---

## Future Enhancements

### Bulk Actions

- Select multiple intents
- Bulk status update (e.g., mark all as junk)
- Bulk export

### Advanced Filtering

- Filter by date range (already supported via dateRange prop)
- Filter by city/device
- Filter by confidence score range
- Filter by matched/unmatched

### Export Functionality

- Export to CSV
- Export to Excel
- Export filtered results

### Status Update UI

- Add status dropdown in drawer header
- Add quick actions (Confirm/Junk buttons) in table row
- Add keyboard shortcuts

### Real-time Updates

- Subscribe to realtime changes for calls
- Auto-refresh when new intents arrive
- Show "new" badge for unread intents

---

## Testing Checklist

- [ ] Intent Ledger loads on mount
- [ ] Filters work correctly (pending/sealed/junk/suspicious)
- [ ] Search filters by page URL
- [ ] Combined filters work (status + search)
- [ ] Click row opens session drawer
- [ ] Session drawer shows timeline correctly
- [ ] Session drawer shows technical details
- [ ] Status update API works
- [ ] Status update refreshes list
- [ ] Empty state displays correctly
- [ ] Loading state displays correctly
- [ ] Error state displays correctly
- [ ] Mobile responsive (drawer slides from bottom)
- [ ] Desktop responsive (drawer centers)

---

## Next Steps

1. **Add Status Dropdown**: In session drawer header for quick status updates
2. **Add Quick Actions**: Confirm/Junk buttons in table row
3. **Create RPC Function**: `get_dashboard_intents()` for server-side filtering
4. **Add Pagination**: For large intent lists
5. **Add Export**: CSV/Excel export functionality
6. **Add Bulk Actions**: Select multiple intents for bulk operations

---

**Status**: ✅ Phase 6 Complete - Intent Ledger with Session Drawer Implemented

**Note**: Current implementation uses client-side filtering. RPC function recommended for production use with large datasets.

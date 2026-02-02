# Timezone Audit Report

**Date**: 2026-01-27  
**Purpose**: Audit timestamp formatting and timezone handling across dashboard UI  
**Status**: Analysis Complete

---

## Executive Summary

This report identifies all timestamp formatting locations in the dashboard UI and recommends a consistent timezone strategy. Current implementation uses mixed locales (`tr-TR`, `en-US`) without explicit timezone handling.

---

## A. Timestamp Formatting Locations

### 1. Call Monitor (`components/dashboard/call-alert.tsx`)

**Line 435**: `matched_at` timestamp
```typescript
{new Date(call.matched_at).toLocaleString('en-US', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
})}
```

**Issue**: 
- Uses `en-US` locale (inconsistent with other components)
- No timezone specified (uses browser local time)
- No timezone indicator shown

---

### 2. Session Timeline (`components/dashboard/session-group.tsx`)

**Multiple locations**:

**Line 340**: Session start time
```typescript
{new Date(firstEvent.created_at).toLocaleString('tr-TR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit'
})}
```

**Lines 551, 603, 611, 662**: Event timestamps in table
```typescript
{new Date(event.created_at).toLocaleTimeString('tr-TR', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  fractionalSecondDigits: 3
})}
```

**Line 715**: Matched call timestamp
```typescript
<span>Match Time: {new Date(matchedCall.created_at).toLocaleString('tr-TR')}</span>
```

**Line 771**: Visitor history session timestamps
```typescript
{new Date(session.created_at).toLocaleString('tr-TR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})}
```

**Issues**:
- Uses `tr-TR` locale (Turkey)
- No explicit timezone (browser local time)
- Inconsistent format across locations

---

### 3. Stats Cards (`components/dashboard/stats-cards.tsx`)

**Line 55**: Last activity timestamp
```typescript
const formatLastSeen = (ts: string | null) => {
  if (!ts) return 'No activity';
  const date = new Date(ts);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};
```

**Issue**:
- No locale specified (uses browser default)
- No timezone specified
- Relative time format ("5m ago") is better but not consistently applied

---

### 4. Other Components

**`components/dashboard/tracked-events-panel.tsx` (Line 148)**:
```typescript
Last: {new Date(eventType.lastSeen).toLocaleString('en-US', {
```

**`components/dashboard/conversion-tracker.tsx` (Line 158)**:
```typescript
{new Date(conv.created_at).toLocaleString('tr-TR')}
```

**`components/dashboard/sites-manager.tsx` (Line 490)**:
```typescript
{new Date(siteStatus[site.id].last_event_at!).toLocaleString()}
```

**Issues**: Mixed locales, no timezone handling

---

## B. Current Timezone Strategy

### Database Storage
- **Assumption**: All timestamps stored as `timestamptz` (UTC) in PostgreSQL
- **Verification needed**: Check schema to confirm

### Display Strategy
- **Current**: Browser local timezone (implicit)
- **Locale**: Mixed (`tr-TR`, `en-US`, browser default)
- **No timezone indicator**: Users can't tell what timezone is shown

---

## C. Recommended Timezone Strategy

### Option 1: Europe/Istanbul (Recommended for Turkish users)

**Rule**: Store UTC, display Europe/Istanbul consistently

**Implementation**:
```typescript
// Create utility function
export function formatTimestamp(ts: string | null, options?: Intl.DateTimeFormatOptions): string {
  if (!ts) return '—';
  const date = new Date(ts);
  return date.toLocaleString('tr-TR', {
    timeZone: 'Europe/Istanbul',
    ...options
  });
}

// Usage
formatTimestamp(call.matched_at, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
});
```

**Pros**:
- Consistent for Turkish market
- Explicit timezone
- Easy to change later

**Cons**:
- Not ideal for international users

---

### Option 2: Browser Local Timezone (Current, but explicit)

**Rule**: Store UTC, display in user's browser timezone explicitly

**Implementation**:
```typescript
export function formatTimestamp(ts: string | null, options?: Intl.DateTimeFormatOptions): string {
  if (!ts) return '—';
  const date = new Date(ts);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return date.toLocaleString('en-US', {
    timeZone: tz,
    ...options
  }) + ` (${tz})`;
}
```

**Pros**:
- Works for all users
- Shows timezone indicator

**Cons**:
- Different users see different times
- Harder to compare across users

---

### Option 3: UTC Always (Developer-friendly)

**Rule**: Store UTC, display UTC with indicator

**Implementation**:
```typescript
export function formatTimestamp(ts: string | null, options?: Intl.DateTimeFormatOptions): string {
  if (!ts) return '—';
  const date = new Date(ts);
  return date.toLocaleString('en-US', {
    timeZone: 'UTC',
    ...options
  }) + ' UTC';
}
```

**Pros**:
- Consistent across all users
- No ambiguity

**Cons**:
- Not user-friendly for non-technical users

---

## D. Recommended Approach: Europe/Istanbul with Timezone Indicator

**Decision**: Use Europe/Istanbul with explicit timezone indicator

**Rationale**:
- Primary market is Turkey
- Explicit timezone prevents confusion
- Can add user preference later

**Implementation Plan**:

1. **Create utility function** (`lib/utils.ts`):
```typescript
export function formatTimestamp(
  ts: string | null, 
  options?: Intl.DateTimeFormatOptions
): string {
  if (!ts) return '—';
  const date = new Date(ts);
  return date.toLocaleString('tr-TR', {
    timeZone: 'Europe/Istanbul',
    ...options
  });
}

export function formatTimestampWithTZ(
  ts: string | null,
  options?: Intl.DateTimeFormatOptions
): string {
  if (!ts) return '—';
  const formatted = formatTimestamp(ts, options);
  return `${formatted} (TRT)`;
}
```

2. **Replace all timestamp formatting**:
   - `components/dashboard/call-alert.tsx` (line 435)
   - `components/dashboard/session-group.tsx` (lines 340, 551, 603, 611, 662, 715, 771)
   - `components/dashboard/stats-cards.tsx` (line 55)
   - `components/dashboard/tracked-events-panel.tsx` (line 148)
   - `components/dashboard/conversion-tracker.tsx` (line 158)
   - `components/dashboard/sites-manager.tsx` (line 490)

---

## E. Files to Modify

1. `lib/utils.ts` - Add `formatTimestamp` and `formatTimestampWithTZ` functions
2. `components/dashboard/call-alert.tsx` - Replace line 435
3. `components/dashboard/session-group.tsx` - Replace lines 340, 551, 603, 611, 662, 715, 771
4. `components/dashboard/stats-cards.tsx` - Replace line 55
5. `components/dashboard/tracked-events-panel.tsx` - Replace line 148
6. `components/dashboard/conversion-tracker.tsx` - Replace line 158
7. `components/dashboard/sites-manager.tsx` - Replace line 490

---

## F. Verification Checklist

After implementation:
- [ ] All timestamps use `formatTimestamp` or `formatTimestampWithTZ`
- [ ] Timezone indicator visible (or consistent implicit)
- [ ] No `toLocaleString` calls without timezone
- [ ] Test with different browser timezones (should show TRT)
- [ ] Verify UTC storage in database

---

**Next Steps**: Implement utility function and replace all timestamp formatting calls.

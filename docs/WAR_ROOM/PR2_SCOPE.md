# PR2 SCOPE LOCK - Single Source of Truth Modules

**Date:** 2026-01-25  
**Purpose:** Lock exact extraction targets and UI fixes for PR2  
**Status:** 🔒 LOCKED - Ready to operate

---

## A) GEO EXTRACTION BLOCK(S)

### Location
**File:** `app/api/sync/route.ts`  
**Lines:** 215-266 (52 lines)  
**Function:** Inline logic within POST handler

### Current Implementation
```typescript
// Lines 215-240: Device & Geo Enrichment
const parser = new UAParser(userAgent);

// Normalize device_type to desktop/mobile/tablet
const rawDeviceType = parser.getDevice().type;
let deviceType = 'desktop'; // default
if (rawDeviceType === 'mobile') {
    deviceType = 'mobile';
} else if (rawDeviceType === 'tablet') {
    deviceType = 'tablet';
} else {
    // Fallback: check user agent for mobile/tablet patterns
    const uaLower = userAgent.toLowerCase();
    if (uaLower.includes('mobile') || uaLower.includes('android') || uaLower.includes('iphone')) {
        deviceType = 'mobile';
    } else if (uaLower.includes('tablet') || uaLower.includes('ipad')) {
        deviceType = 'tablet';
    }
}

const deviceInfo = {
    device_type: deviceType,
    os: parser.getOS().name || 'Unknown',
    browser: parser.getBrowser().name || 'Unknown',
    browser_version: parser.getBrowser().version,
};

// Lines 242-266: Geo extraction from headers
const cityFromHeader = req.headers.get('cf-ipcity') || 
                       req.headers.get('x-city') || 
                       req.headers.get('x-forwarded-city') ||
                       null;

const districtFromHeader = req.headers.get('cf-ipdistrict') ||
                          req.headers.get('x-district') ||
                          null;

// Priority: Metadata override > Server headers > Unknown
const city = meta?.city || cityFromHeader || null;
const district = meta?.district || districtFromHeader || null;

const geoInfo = {
    city: city || 'Unknown',
    district: district,
    country: req.headers.get('cf-ipcountry') || 
             req.headers.get('x-country') || 
             'Unknown',
    timezone: req.headers.get('cf-timezone') || 
             req.headers.get('x-timezone') || 
             'Unknown',
};
```

### Inputs
- `req: NextRequest` - Request object with headers
- `userAgent: string` - User agent string
- `meta?: any` - Optional metadata object with `city` and `district` overrides

### Outputs
- `deviceInfo: { device_type, os, browser, browser_version }`
- `geoInfo: { city, district, country, timezone }`

### Normalization Rules
1. **Device Type:** desktop (default) → mobile/tablet based on UAParser + fallback patterns
2. **City:** Metadata override > CF-IPCity/X-City headers > 'Unknown'
3. **District:** Metadata override > CF-IPDistrict/X-District headers > null
4. **Country:** CF-IPCountry/X-Country headers > 'Unknown'
5. **Timezone:** CF-Timezone/X-Timezone headers > 'Unknown'

### Extraction Target
**New File:** `lib/geo.ts`  
**Function:** `extractGeoInfo(req: NextRequest, userAgent: string, meta?: any): { geoInfo, deviceInfo }`

---

## B) LEAD SCORING BLOCK(S)

### Location
**File:** `app/api/sync/route.ts`  
**Lines:** 321-342 (22 lines)  
**Function:** Inline logic within POST handler

### Current Implementation
```typescript
// 4. Lead Scoring Engine (The "Math")
let leadScore = 0;

// A. Category Scoring
if (event_category === 'conversion') leadScore += 50;
if (event_category === 'interaction') leadScore += 10;

// B. Deep Engagement Scoring
if (event_action === 'scroll_depth') {
    const depth = Number(event_value);
    if (depth >= 50) leadScore += 10;
    if (depth >= 90) leadScore += 20;
}

if (event_action === 'hover_intent') leadScore += 15;

// C. Context Scoring
if (referrer?.includes('google')) leadScore += 5;
if (isReturningAdUser) leadScore += 25; // Returning ad users are high intent

// Cap Score
leadScore = Math.min(leadScore, 100);
```

### Inputs
- `event_category: string` - Event category ('conversion', 'interaction', etc.)
- `event_action: string` - Event action ('scroll_depth', 'hover_intent', etc.)
- `event_value: number | null` - Event value (for scroll_depth)
- `referrer: string | null` - Referrer URL
- `isReturningAdUser: boolean` - Whether user is returning ad user (multi-touch attribution)

### Outputs
- `leadScore: number` - Score from 0 to 100 (capped)

### Scoring Rules
1. **Category Scoring:**
   - `conversion` → +50
   - `interaction` → +10
2. **Deep Engagement:**
   - `scroll_depth >= 50` → +10
   - `scroll_depth >= 90` → +20
   - `hover_intent` → +15
3. **Context:**
   - Referrer includes 'google' → +5
   - Returning ad user → +25
4. **Cap:** Maximum 100

### Extraction Target
**New File:** `lib/scoring.ts`  
**Function:** `computeLeadScore(event: { category, action, value }, referrer: string | null, isReturningAdUser: boolean): number`

---

## C) UI FIXES

### C1: Attribution Fallback Redundancy

**Location:** `components/dashboard/session-group.tsx`  
**Line:** 62  
**Current Behavior:**
```typescript
const attributionSource = sessionData?.attribution_source || metadata.attribution_source || 'Organic';
```

**Issue:** Redundant `|| 'Organic'` fallback. `computeAttribution()` in `lib/attribution.ts` always returns a source value (never undefined/null), so the fallback is unnecessary.

**Fix:** Remove `|| 'Organic'` fallback
```typescript
const attributionSource = sessionData?.attribution_source || metadata.attribution_source;
```

**Why:** `computeAttribution()` guarantees a return value (see `lib/attribution.ts`), so the fallback is dead code.

---

### C2: Live Feed Filtering Logic

**Location:** `components/dashboard/live-feed.tsx`  
**Lines:** 346-366 (filterOptions extraction), 369-387 (displayedSessions filtering)

**Current Behavior:**
```typescript
// Lines 346-366: Extract filter options from event metadata
Object.values(groupedSessions).forEach((sessionEvents) => {
  if (sessionEvents.length > 0) {
    const metadata = sessionEvents[sessionEvents.length - 1]?.metadata || {};
    if (metadata.city && metadata.city !== 'Unknown') cities.add(metadata.city);
    if (metadata.district) districts.add(metadata.district);
    if (metadata.device_type) devices.add(metadata.device_type);
  }
});

// Lines 373-383: Filter sessions using event metadata
filtered = filtered.filter(([sessionId, sessionEvents]) => {
  if (sessionEvents.length === 0) return false;
  const metadata = sessionEvents[sessionEvents.length - 1]?.metadata || {};
  
  if (selectedCity && metadata.city !== selectedCity) return false;
  if (selectedDistrict && metadata.district !== selectedDistrict) return false;
  if (selectedDevice && metadata.device_type !== selectedDevice) return false;
  
  return true;
});
```

**Issue:** Filters on event metadata instead of normalized session fields. Session table has `city`, `district`, `device_type` columns that should be preferred.

**Current Data Flow:**
1. `groupedSessions` contains events grouped by `session_id`
2. Filter extraction reads from `event.metadata` (last event in session)
3. Filter application reads from `event.metadata` (last event in session)

**Desired Data Flow:**
1. Fetch session data for each session (or enhance grouped structure)
2. Filter extraction reads from `session.city/district/device_type` first, fallback to `event.metadata`
3. Filter application reads from `session.city/district/device_type` first, fallback to `event.metadata`

**Challenge:** `groupedSessions` structure doesn't include session normalized fields. To fix properly, we'd need to:
- Option A: Fetch session data for each session (N+1 queries, expensive)
- Option B: Enhance `groupedSessions` structure to include session data (requires refactor)
- Option C: Keep current implementation (filters on metadata, which contains same values)

**Decision for PR2:** Keep current implementation (Option C). This is a larger refactor better suited for PR4 (UI Data Boundary Cleanup). Event metadata contains the same values as session normalized fields (they're synced during ingestion), so filtering on metadata is functionally equivalent.

**Note:** Document this limitation in PR2_EVIDENCE.md, but don't implement the fix in PR2.

---

## D) IMPLEMENTATION PLAN

### Step 1: Create `lib/geo.ts`
- [ ] Create new file `lib/geo.ts`
- [ ] Export `extractGeoInfo(req, userAgent, meta)` function
- [ ] Copy verbatim logic from `app/api/sync/route.ts:215-266`
- [ ] Define TypeScript interfaces: `GeoInfo`, `DeviceInfo`, `GeoExtractionResult`
- [ ] Add JSDoc comments explaining inputs/outputs
- [ ] Import `NextRequest` from `next/server`
- [ ] Import `UAParser` from `ua-parser-js`

### Step 2: Create `lib/scoring.ts`
- [ ] Create new file `lib/scoring.ts`
- [ ] Export `computeLeadScore(event, referrer, isReturningAdUser)` function
- [ ] Copy verbatim logic from `app/api/sync/route.ts:321-342`
- [ ] Define TypeScript interface: `EventInput`
- [ ] Add JSDoc comments explaining scoring rules
- [ ] Ensure return type is `number` (0-100)

### Step 3: Update `app/api/sync/route.ts`
- [ ] Add imports: `import { extractGeoInfo } from '@/lib/geo'` and `import { computeLeadScore } from '@/lib/scoring'`
- [ ] Remove `UAParser` import (no longer needed in sync route)
- [ ] Replace lines 215-266 with: `const { geoInfo, deviceInfo } = extractGeoInfo(req, userAgent, meta);`
- [ ] Replace lines 321-342 with: `const leadScore = computeLeadScore({ event_category, event_action, event_value }, referrer || null, isReturningAdUser);`
- [ ] Verify `deviceType` usage: `const deviceType = deviceInfo.device_type;`
- [ ] Verify all `geoInfo` and `deviceInfo` usages remain unchanged

### Step 4: Fix Attribution Fallback
- [ ] Update `components/dashboard/session-group.tsx:62`
- [ ] Remove `|| 'Organic'` fallback
- [ ] Add comment: "Note: computeAttribution always returns a value, so 'Organic' fallback is redundant"

### Step 5: Document Live Feed Filter Limitation
- [ ] Add note in PR2_EVIDENCE.md about Live Feed filter using metadata (not session fields)
- [ ] Explain why this is deferred to PR4 (requires larger refactor)

### Step 6: Acceptance Checks
- [ ] Run `npx tsc --noEmit` - must pass
- [ ] Run `npm run build` - must pass
- [ ] Run `npm run check:warroom` - must pass
- [ ] Run `npm run check:attribution` - must pass
- [ ] Verify geo extraction produces identical results (smoke test)
- [ ] Verify lead scoring produces identical results (smoke test)

---

## VERIFICATION REQUIREMENTS

### Geo Extraction Verification
**Test:** Same inputs → Same outputs  
**Inputs:** `req`, `userAgent`, `meta`  
**Expected:** Identical `geoInfo` and `deviceInfo`  
**Method:** Compare before/after outputs for same test cases

### Lead Scoring Verification
**Test:** Same inputs → Same outputs  
**Inputs:** `event_category`, `event_action`, `event_value`, `referrer`, `isReturningAdUser`  
**Expected:** Identical `leadScore`  
**Method:** Compare before/after outputs for same test cases

### Attribution Fallback Verification
**Test:** Attribution display works without 'Organic' fallback  
**Expected:** No UI changes, attribution still displays correctly  
**Method:** Visual inspection + check that `computeAttribution()` always returns value

---

## RISK ASSESSMENT

**Risk Level:** LOW
- **Reason:** Verbatim extraction, no logic changes
- **Impact:** Code organization only, no behavior changes
- **Rollback:** Simple revert (restore inline logic)

**Edge Cases:**
- ✅ Geo extraction priority preserved (metadata > headers > Unknown)
- ✅ Device type normalization unchanged
- ✅ Lead scoring rules unchanged
- ✅ Attribution fallback removed (redundant, not breaking)

---

## FILES TO TOUCH

### New Files (2)
1. `lib/geo.ts` - Geo extraction module
2. `lib/scoring.ts` - Lead scoring module

### Modified Files (2)
3. `app/api/sync/route.ts` - Use new modules
4. `components/dashboard/session-group.tsx` - Remove redundant fallback

### Documentation (1)
5. `docs/WAR_ROOM/PR2_EVIDENCE.md` - Evidence report

---

## CONSTRAINTS

- ✅ NO new dependencies (UAParser already in use)
- ✅ NO logic changes (verbatim copy only)
- ✅ Preserve RLS/site-scope invariants (no changes to security)
- ✅ Keep PR1 deterministic ordering (not touched)
- ✅ Minimal diffs (extraction only, no rewrites)

---

**READY TO OPERATE PR2**

**Last Updated:** 2026-01-25

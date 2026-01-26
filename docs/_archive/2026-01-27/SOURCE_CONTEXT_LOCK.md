# Source & Context Regression Lock

**Date:** 2026-01-25  
**Purpose:** Prevent regressions in attribution source classification and context extraction

---

## MUST NOT REGRESS

### 1. Source Rule Priority Order
**Lock:** Source classification MUST follow priority order:
1. S1: GCLID present → "First Click (Paid)"
2. S2: UTM medium=cpc/ppc/paid → "Paid (UTM)"
3. S3: Google referrer + past GCLID → "Ads Assisted"
4. S4: Social referrer → "Paid Social"
5. S5: Default → "Organic"

**Evidence:** `lib/attribution.ts` - `computeAttribution()` function order

### 2. Sessions Store Normalized Fields
**Lock:** Sessions table MUST store:
- `attribution_source` (computed, not raw)
- `device_type` (normalized: desktop/mobile/tablet)
- `city`, `district` (nullable, from headers or metadata)
- `fingerprint`, `gclid` (for matching)

**Evidence:** Migration `20260125225000_add_sessions_attribution_columns.sql`

### 3. UI Reads from Sessions First
**Lock:** Session cards MUST:
- Read `attribution_source` from `sessions` table first
- Fallback to `events.metadata.attribution_source` only if session field is null
- Same for `device_type`, `city`, `district`

**Evidence:** `components/dashboard/session-group.tsx` - `useEffect` fetches session data

### 4. Context Chips Always Visible
**Lock:** Context chips MUST:
- Always render (even if values are null)
- Show "—" for missing values (not hide chips)
- Use readable text-sm with higher contrast

**Evidence:** `components/dashboard/session-group.tsx` - Context chips row always rendered

### 5. Attribution Function Deterministic
**Lock:** `computeAttribution()` MUST:
- Return same result for same input
- Not depend on external state
- Be pure function (no side effects)

**Evidence:** `lib/attribution.ts` - Pure function implementation

---

## EVIDENCE COMMANDS

### TypeScript Check
```bash
npx tsc --noEmit
```
**Expected:** No errors

### Build Check
```bash
npm run build
```
**Expected:** Compiled successfully

### War Room Lock
```bash
npm run check:warroom
```
**Expected:** No violations found

### Attribution Function Usage
```bash
# Windows
findstr /S /N "computeAttribution" app lib components supabase

# Linux/Mac
grep -r "computeAttribution" app lib components supabase
```
**Expected:** Found in:
- `lib/attribution.ts` (definition)
- `app/api/sync/route.ts` (usage)

### Sessions Attribution Columns
```bash
# Windows
findstr /S /N "attribution_source\|device_type\|city\|district" app lib components supabase

# Linux/Mac
grep -r "attribution_source\|device_type\|city\|district" app lib components supabase
```
**Expected:** Found in:
- `supabase/migrations/20260125225000_add_sessions_attribution_columns.sql` (definition)
- `app/api/sync/route.ts` (storage)
- `components/dashboard/session-group.tsx` (reading)

### UI Reads from Sessions
```bash
# Windows
findstr /S /N "sessions.*attribution_source\|sessions.*device_type\|sessions.*city\|sessions.*district" components/dashboard/session-group.tsx

# Linux/Mac
grep -r "sessions.*attribution_source\|sessions.*device_type\|sessions.*city\|sessions.*district" components/dashboard/session-group.tsx
```
**Expected:** Found session data fetching in `session-group.tsx`

---

## REGRESSION CHECK SCRIPT

Create `scripts/check-attribution.js`:

```javascript
const fs = require('fs');
const path = require('path');

// Check if UI reads from sessions first
const sessionGroupPath = path.join(__dirname, '../components/dashboard/session-group.tsx');
const content = fs.readFileSync(sessionGroupPath, 'utf8');

// Must fetch session data
if (!content.includes("from('sessions')") || !content.includes('attribution_source')) {
  console.error('❌ UI does not read attribution_source from sessions table');
  process.exit(1);
}

// Must use sessionData first, fallback to metadata
if (!content.includes('sessionData?.attribution_source') || !content.includes('metadata.attribution_source')) {
  console.error('❌ UI does not use sessionData first, fallback to metadata');
  process.exit(1);
}

console.log('✅ Attribution regression checks passed');
```

Add to `package.json`:
```json
{
  "scripts": {
    "check:attribution": "node scripts/check-attribution.js"
  }
}
```

---

## ACCEPTANCE CRITERIA

| Criteria | Lock | Evidence |
|----------|------|----------|
| Source rule priority preserved | ✅ | `lib/attribution.ts` function order |
| Sessions store normalized fields | ✅ | Migration adds columns |
| UI reads from sessions first | ✅ | `session-group.tsx` useEffect |
| Context chips always visible | ✅ | Always rendered, "—" for null |
| Attribution function deterministic | ✅ | Pure function, no side effects |
| No service role leaks | ✅ | `check:warroom` passes |
| Month partitions intact | ✅ | `session_month` filtering preserved |
| RLS join patterns intact | ✅ | No changes to RLS policies |

---

## EDGE CASES (Must Not Regress)

1. **GCLID present but UTM missing**
   - Result: "First Click (Paid)" (S1 wins)
   - Lock: GCLID check comes before UTM check

2. **UTM says cpc but referrer empty**
   - Result: "Paid (UTM)" (S2 wins)
   - Lock: UTM check comes before referrer check

3. **Geo missing (no city/district)**
   - Result: UI shows "—" (not hidden)
   - Lock: Context chips always rendered

4. **Legacy sessions lacking new columns**
   - Result: Fallback to event metadata
   - Lock: `sessionData?.attribution_source || metadata.attribution_source`

5. **Month boundary partition**
   - Result: Sessions/events filtered correctly
   - Lock: `session_month` / `created_month` filtering preserved

---

**Last Updated:** 2026-01-25

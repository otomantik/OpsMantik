# Source & Context Classification Truth Table

**Date:** 2026-01-25  
**Purpose:** Definitive rules for attribution source classification and context extraction

---

## SOURCE CLASSIFICATION RULES (Priority Order)

### S1: First Click (Paid)
**Condition:** `gclid` present in URL params OR metadata  
**Priority:** Highest  
**Logic:**
```javascript
if (gclid) return "First Click (Paid)";
```

### S2: Paid (UTM)
**Condition:** `utm_medium` in URL params equals `cpc`, `ppc`, or `paid`  
**Priority:** High  
**Logic:**
```javascript
if (utm_medium === 'cpc' || utm_medium === 'ppc' || utm_medium === 'paid') {
  return "Paid (UTM)";
}
```

### S3: Ads Assisted
**Condition:** 
- No current `gclid` in URL
- `referrer` contains `google` OR `googleads`
- Past session (matched by fingerprint) had `gclid` stored
**Priority:** Medium  
**Logic:**
```javascript
if (!currentGclid && referrer.includes('google') && pastGclidExists) {
  return "Ads Assisted";
}
```

### S4: Paid Social
**Condition:** `referrer` contains `facebook`, `instagram`, `linkedin`, `twitter`, `tiktok`  
**Priority:** Medium  
**Logic:**
```javascript
const socialDomains = ['facebook', 'instagram', 'linkedin', 'twitter', 'tiktok'];
if (socialDomains.some(domain => referrer.includes(domain))) {
  return "Paid Social";
}
```

### S5: Organic (Default)
**Condition:** None of the above  
**Priority:** Lowest (fallback)  
**Logic:**
```javascript
return "Organic";
```

---

## CONTEXT EXTRACTION RULES

### Device Type
**Source:** User-Agent parsing (server-side)  
**Values:** `desktop` | `mobile` | `tablet`  
**Logic:**
1. Parse User-Agent with UAParser
2. Check `parser.getDevice().type`
3. Fallback: Check UA string for mobile/tablet patterns
4. Default: `desktop`

### City
**Source Priority:**
1. Server-side geo header: `cf-ipcity` OR `x-city` OR `x-forwarded-city`
2. Metadata override: `meta.city` (if provided)
3. Default: `null` (UI shows "—")

### District
**Source Priority:**
1. Server-side geo header: `cf-ipdistrict` OR `x-district`
2. Metadata override: `meta.district` (if provided)
3. Default: `null` (UI shows "—")

---

## REQUIRED METADATA FIELDS

### Must Exist in `event.metadata`:
- `fp` (fingerprint) - Browser fingerprint hash
- `gclid` (nullable) - Google Click ID
- `utm` (nullable) - UTM parameters object: `{ medium, source, campaign }`
- `ref` (nullable) - Referrer URL
- `device_type` - `desktop` | `mobile` | `tablet`
- `city` (nullable) - City name
- `district` (nullable) - District name

### Stored in `sessions` table (normalized):
- `attribution_source` (text) - Computed source classification
- `device_type` (text) - Normalized device type
- `city` (text, nullable) - City name
- `district` (text, nullable) - District name
- `gclid` (text, nullable) - Google Click ID
- `fingerprint` (text, nullable) - Browser fingerprint

---

## CLASSIFICATION FLOW

```
Input: { gclid, utm, referrer, fingerprint, pastSessions }
  ↓
Check S1: gclid present?
  YES → "First Click (Paid)"
  NO → Continue
  ↓
Check S2: utm_medium in [cpc, ppc, paid]?
  YES → "Paid (UTM)"
  NO → Continue
  ↓
Check S3: referrer contains google + past gclid?
  YES → "Ads Assisted"
  NO → Continue
  ↓
Check S4: referrer contains social domain?
  YES → "Paid Social"
  NO → Continue
  ↓
Default: "Organic"
```

---

## EDGE CASES

1. **GCLID present but UTM missing**
   - Result: "First Click (Paid)" (S1 wins)

2. **UTM says cpc but referrer empty**
   - Result: "Paid (UTM)" (S2 wins)

3. **Geo missing (no city/district)**
   - Result: `null` → UI shows "—"

4. **Legacy sessions lacking new columns**
   - Fallback: Read from first event metadata

5. **Month boundary partition**
   - Sessions/events still filtered correctly by `created_month` / `session_month`

---

**Last Updated:** 2026-01-25

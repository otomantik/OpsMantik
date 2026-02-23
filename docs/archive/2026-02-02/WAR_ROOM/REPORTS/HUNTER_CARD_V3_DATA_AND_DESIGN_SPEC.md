# HunterCard v3 (Predator HUD) – Phase 1 Data Reconnaissance & Phase 2 Design Spec

**Role:** Senior Frontend Engineer & UX Designer (CRM Dashboards)  
**Context:** Live system with Google Ads Tracking Template:  
`{lpurl}?utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&utm_term={keyword}&matchtype={matchtype}&device={device}&network={network}`  
**Objective:** Retire generic v2 Hunter Card; implement HunterCard v3 (Predator HUD) with maximum “Wow Factor” via intelligence data.

---

## Phase 1: Data Reconnaissance (Schema Analysis)

### 1. Keyword Extraction

| Requirement | Status | Details |
|------------|--------|---------|
| **utm_term** | ✅ **Captured** | `sessions.utm_term` (TEXT) added in migration `20260130250000_sessions_utm_term_matchtype.sql`. Sync route extracts from URL via `lib/attribution.ts` `extractUTM()` and persists on session create/update. |
| **utm_content** | ⚠️ **Extracted, not stored** | `extractUTM()` returns `utm_content`; **sessions** has no dedicated column. Optional enhancement: add `sessions.utm_content` if ad variation display is needed. |
| **query_params JSONB** | ❌ **Not used** | No generic `query_params` column. We rely on explicit UTM/matchtype columns for clarity and indexing. |

**Display:** The exact keyword (e.g. “antique silver price” / “gümüş obje alanlar”) is available as `sessions.utm_term` and is exposed in `get_recent_intents_v2` as `utm_term` for the INTEL BOX.

---

### 2. Match Type Decoding

| Requirement | Status | Details |
|------------|--------|---------|
| **Storing matchtype (e, p, b)** | ✅ **Captured** | `sessions.matchtype` (TEXT) in same migration. Sync extracts URL param `matchtype` and persists it. |
| **Logic: e = High Intent 🔥, b = Medium** | ✅ **Implemented** | `lib/types/hunter.ts` exposes `decodeMatchType(matchtype)` → `{ type, label, highIntent }`. e → Exact Match (highIntent: true), p → Phrase, b → Broad. HunterCard shows [Exact Match] badge with fire when highIntent. |

RPC `get_recent_intents_v2` returns `matchtype`; UI decodes for badge (Exact Match vs Broad).

---

### 3. Location Granularity

| Requirement | Status | Details |
|------------|--------|---------|
| **City** | ✅ **Captured** | `sessions.city` (TEXT) from `20260125225000_add_sessions_attribution_columns.sql`. |
| **District** | ✅ **Captured** | `sessions.district` (TEXT) in same migration. |
| **Source** | ✅ **Implemented** | `lib/geo.ts` `extractGeoInfo()`: district from **Cloudflare** `cf-ipdistrict`, **generic** `x-district`, or **metadata** override. City from Vercel/Cloudflare/generic headers. Sync route persists `geoInfo.city` and `geoInfo.district`. |

**Display:** “Kadıköy / Istanbul” is supported: card shows `city` + `district` when both exist (e.g. `location = district ? `${city} / ${district}` : city`). RPC v2 returns `city` and `district` for Hunter Card (migration `20260130250100_intents_v2_intel_fields.sql`).

---

### 4. Device Fingerprint

| Requirement | Status | Details |
|------------|--------|---------|
| **Google device={m/c/t}** | ⚠️ **Not stored** | Tracking template sends `device` (m/c/t). We do **not** persist it as a separate column. Device experience is derived from **User-Agent** in `lib/geo.ts` (ua-parser-js) → normalized `device_type` (desktop/mobile/tablet). |
| **Override vs complement** | — | Google’s `device` could **complement** UA: e.g. store `ads_device` (m/c/t) and show “Google: Mobile” next to “UA: iPhone”. Optional migration: `sessions.ads_device TEXT`. |
| **Specific model (e.g. iPhone 15, Samsung S24)** | ⚠️ **Not implemented** | UA parsing gives `device_type`, `os`, `browser`, `browser_version`. We do **not** map to “iPhone 14 Pro” or “Samsung S24”. Would require a device lookup table or library (e.g. device-detector-js) and possibly a `device_model` or `user_agent_parsed` JSONB column. |

**Conclusion:** Current TARGET HUD can show “Desktop” / “Mobile” / “Tablet” and OS/browser from existing fields. Specific model names are a future enhancement (new column + parsing).

---

## Phase 2: Hunter Card v3 Design Spec (Alignment)

| Spec | Implementation |
|------|----------------|
| **Header: Dynamic color** | Green (WhatsApp / High Score / Exact), Blue (Phone), Purple (Form) – existing `sourceStripClass()` and badges. |
| **INTEL BOX** | Keyword from `utm_term` (or derived interest/campaign); Match Type badge [Exact Match] / [Broad]; Campaign from `utm_campaign` (when exposed from session or first-event URL). |
| **TARGET HUD** | Location: 📍 city + district. Device: 📱 device_type (and later model/network if we add columns). Telco: carrier/format – not yet (would need carrier lookup or display of `intent_target` only). |
| **CASINO CHIP** | Estimated value: `calls.estimated_value` (and optional range) – type in `HunterCardIntentV3`; show “💰 Est. 5K–20K ₺” when present. |
| **Footer** | SEAL DEAL (Casino modal), JUNK (reason), WHATSAPP (direct link) – existing actions. |

---

## TypeScript Interface: HunterCardProps (Granular Fields)

**Location:** `lib/types/hunter.ts`

```ts
export interface HunterCardIntentV3 {
  id: string;
  intent_action?: 'whatsapp' | 'phone' | 'form' | 'other' | null;
  intent_target?: string | null;
  created_at: string;

  // INTEL BOX
  utm_term?: string | null;
  utm_campaign?: string | null;
  utm_source?: string | null;
  matchtype?: string | null;

  // TARGET HUD
  city?: string | null;
  district?: string | null;
  device_type?: string | null;
  device_model?: string | null;   // future
  network?: string | null;        // future
  telco_carrier?: string | null;  // future

  // CASINO CHIP
  estimated_value?: number | null;
  currency?: string | null;
  lead_score?: number | null;
  ai_score?: number | null;
  ai_summary?: string | null;
  ai_tags?: string[] | null;

  // Existing (page, risk, OCI, etc.)
  page_url?: string | null;
  intent_page_url?: string | null;
  intent_stamp?: string | null;
  risk_level?: 'low' | 'high' | string | null;
  total_duration_sec?: number | null;
  click_id?: string | null;
  matched_session_id?: string | null;
  status?: string | null;
  oci_status?: string | null;
  oci_status_updated_at?: string | null;
  oci_uploaded_at?: string | null;
  oci_batch_id?: string | null;
  oci_error?: string | null;
  oci_matchable?: boolean;
  risk_reasons?: string[];
  oci_stage?: string;
  attribution_source?: string | null;
  event_count?: number | null;
}

export interface HunterCardV3Props {
  intent: HunterCardIntentV3;
  siteId?: string;
  onSeal?: (intent: HunterCardIntentV3) => void;
  onJunk?: (intent: HunterCardIntentV3, reason?: string) => void;
  onWhatsApp?: (intent: HunterCardIntentV3) => void;
}
```

Helper: `decodeMatchType(matchtype)` → `{ type: 'exact'|'phrase'|'broad'|'unknown', label, highIntent }`.

---

## DB Migration Checklist

| Change | Status | Migration |
|--------|--------|-----------|
| Add **utm_term** to sessions | ✅ Done | `20260130250000_sessions_utm_term_matchtype.sql` |
| Add **matchtype** to sessions | ✅ Done | Same |
| **district** (and city) | ✅ Already existed | `20260125225000_add_sessions_attribution_columns.sql` |
| **device_type** | ✅ Already existed | Same |
| RPC v2 intel fields (utm_term, matchtype, city, district, device_type) | ✅ Done | `20260130250100_intents_v2_intel_fields.sql` |
| utm_content (optional) | ❌ Not added | Add column + sync if ad variation needed |
| Google ads_device (m/c/t) (optional) | ❌ Not added | Add column + extract from URL if desired |
| device_model / network (optional) | ❌ Not added | Future: parsing or JSONB for UA/model |

**Conclusion:** No further DB migration is **required** before building the Hunter Card v3 UI. Optional columns (utm_content, ads_device, device_model) can be added later for richer TARGET HUD / INTEL BOX.

---

## Summary

- **Keyword:** ✅ `sessions.utm_term` + RPC v2; display exact keyword in INTEL BOX.
- **Match type:** ✅ `sessions.matchtype` + decode (e=Exact 🔥, b=Broad); badge in INTEL BOX.
- **Location:** ✅ `sessions.city` + `sessions.district`; show “Kadıköy / Istanbul” in TARGET HUD.
- **Device:** ✅ Normalized `device_type` (desktop/mobile/tablet); specific model/network/telco are future enhancements.
- **TypeScript:** `HunterCardIntentV3` and `HunterCardV3Props` in `lib/types/hunter.ts` cover all granular fields.
- **Migrations:** Required migrations are in place; UI can consume RPC v2 and render Predator HUD per spec.

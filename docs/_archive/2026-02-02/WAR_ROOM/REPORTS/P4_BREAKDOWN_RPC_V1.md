# P4-1 Breakdown RPC v1 — get_dashboard_breakdown_v1

**Goal:** Return 3 datasets (sources, locations, devices) for a given site + date range with optional strict `adsOnly` filter.

---

## Function signature

```sql
public.get_dashboard_breakdown_v1(
  p_site_id   uuid,
  p_date_from timestamptz,
  p_date_to   timestamptz,
  p_ads_only  boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
```

- **Data source:** `public.sessions` (partitioned).
- **Filters (MUST):**
  - `s.site_id = p_site_id`
  - `s.created_at BETWEEN p_date_from AND p_date_to`
  - `s.created_month BETWEEN date_trunc('month', p_date_from)::date AND date_trunc('month', p_date_to)::date`
  - If `p_ads_only = true`: **AND** `public.is_ads_session(s) = true` (STRICT, no attribution fallback).

---

## Bucket rules (adsOnly strictness)

### Sources

- **If `p_ads_only = true`:**
  - All sessions are already ads; for simplicity return only:
    - `"Google Ads"`: count = total, pct = 100 (when total > 0)
    - `"Other"`: count = 0, pct = 0
- **If `p_ads_only = false`:**
  - `"Paid Social"`: `attribution_source ILIKE '%Paid Social%'`
  - `"Organic"`: `attribution_source ILIKE '%Organic%'`
  - `"Google Ads"`: `public.is_ads_session(s) = true` (and not already Paid Social / Organic)
  - `"Direct/Unknown"`: `attribution_source` is null or empty
  - `"Other"`: remainder

### Locations

- **Dimension:** Prefer `district` if not null/empty; else `city`; else `'Unknown'`.
- **Output:** Top 8 locations by count + `"Other"` for the rest.

### Devices

- **Normalize `device_type`:**
  - Contains `'mobile'` → **Mobile**
  - Contains `'desktop'` → **Desktop**
  - Null/empty → **Unknown**
  - Else → **Other**

### Percent

- `pct = round(count * 100.0 / total, 1)`.
- If `total_sessions = 0`, return empty arrays (or arrays with zero counts); response MUST be valid JSON.

---

## Example output

```json
{
  "total_sessions": 123,
  "sources": [
    { "name": "Google Ads", "count": 123, "pct": 100 },
    { "name": "Other", "count": 0, "pct": 0 }
  ],
  "locations": [
    { "name": "Kadıköy", "count": 45, "pct": 36.6 },
    { "name": "Beşiktaş", "count": 30, "pct": 24.4 },
    { "name": "Other", "count": 48, "pct": 39.0 }
  ],
  "devices": [
    { "name": "Mobile", "count": 98, "pct": 79.7 },
    { "name": "Desktop", "count": 20, "pct": 16.3 },
    { "name": "Other", "count": 5, "pct": 4.1 }
  ]
}
```

With `p_ads_only = false`, `sources` may include multiple buckets, e.g.:

```json
"sources": [
  { "name": "Google Ads", "count": 80, "pct": 65.0 },
  { "name": "Organic", "count": 25, "pct": 20.3 },
  { "name": "Direct/Unknown", "count": 12, "pct": 9.8 },
  { "name": "Paid Social", "count": 4, "pct": 3.3 },
  { "name": "Other", "count": 2, "pct": 1.6 }
]
```

---

## Migration

- **File:** `supabase/migrations/20260130240000_dashboard_breakdown_v1.sql`
- **Apply:** `supabase db push` (or run the migration SQL in Supabase SQL editor).

---

## Smoke

- **Script:** `scripts/smoke/p4-breakdown-proof.mjs`
- **Run:** `npm run smoke:p4-breakdown` or `node scripts/smoke/p4-breakdown-proof.mjs`
- **Env:** `SITE_ID` or `TEST_SITE_ID`, optional `P4_FROM`, `P4_TO` (ISO); else first site + last 7 days.
- **Behavior:** Calls RPC twice (`p_ads_only = true` and `false`), asserts JSON shape, `pct` in [0, 100], and device sum > 0 when total_sessions > 0; writes `docs/WAR_ROOM/EVIDENCE/P4_BREAKDOWN/rpc_result_v1.json` and `smoke_log.txt`.

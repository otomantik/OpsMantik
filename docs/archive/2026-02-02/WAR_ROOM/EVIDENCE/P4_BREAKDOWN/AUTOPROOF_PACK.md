# P4-1 Breakdown v1 — AUTOPROOF PACK

**Scope:** Backend RPC `get_dashboard_breakdown_v1`. Returns 3 datasets: **sources**, **locations**, **devices** for site + date range. Optional strict `p_ads_only` filter (`public.is_ads_session(s)` when true). Output keys: `name`, `count`, `pct`.

---

## 1) Files touched

| File | Change |
|------|--------|
| `supabase/migrations/20260130240000_dashboard_breakdown_v1.sql` | **NEW** — `get_dashboard_breakdown_v1(uuid, timestamptz, timestamptz, boolean)` |
| `scripts/smoke/p4-breakdown-proof.mjs` | **MOD** — Calls RPC twice (ads_only=true, ads_only=false), asserts JSON shape (name/count/pct), writes `rpc_result_v1.json` |
| `docs/WAR_ROOM/REPORTS/P4_BREAKDOWN_RPC_V1.md` | **NEW** — Function signature, bucket rules, example output |
| `docs/WAR_ROOM/EVIDENCE/P4_BREAKDOWN/AUTOPROOF_PACK.md` | **NEW** — This file |

---

## 2) Key diff hunks

- **get_dashboard_breakdown_v1:** Inclusive range `created_at BETWEEN p_date_from AND p_date_to`; partition pruning via `created_month BETWEEN v_month_from AND v_month_to`. Filter: `(NOT p_ads_only OR public.is_ads_session(s))`.
- **Sources (p_ads_only=true):** Only "Google Ads" (count=total, pct=100) + "Other" (0, 0).
- **Sources (p_ads_only=false):** Paid Social / Organic / Google Ads / Direct/Unknown / Other by attribution rules.
- **Locations:** `COALESCE(NULLIF(BTRIM(district),''), NULLIF(BTRIM(city),''), 'Unknown')`, top 8 + Other.
- **Devices:** Mobile (contains 'mobile'), Desktop (contains 'desktop'), null/empty → Unknown, else Other.
- **pct:** `round(count * 100.0 / total, 1)`; if total=0 return empty arrays.

---

## 3) Migration id + SQL snippet

**Migration:** `20260130240000_dashboard_breakdown_v1.sql`

```sql
CREATE OR REPLACE FUNCTION public.get_dashboard_breakdown_v1(
  p_site_id uuid,
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_ads_only boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp
AS $$
DECLARE
  v_month_from date;
  v_month_to date;
  v_total bigint;
  v_sources jsonb;
  v_locations jsonb;
  v_devices jsonb;
BEGIN
  PERFORM validate_date_range(p_date_from, p_date_to);
  v_month_from := DATE_TRUNC('month', p_date_from)::date;
  v_month_to   := DATE_TRUNC('month', p_date_to)::date;

  SELECT COUNT(*) INTO v_total
  FROM public.sessions s
  WHERE s.site_id = p_site_id
    AND s.created_at BETWEEN p_date_from AND p_date_to
    AND s.created_month BETWEEN v_month_from AND v_month_to
    AND (NOT p_ads_only OR public.is_ads_session(s));
  v_total := COALESCE(v_total, 0);

  -- Sources: ads_only -> Google Ads + Other; else Paid Social/Organic/Google Ads/Direct/Unknown/Other
  -- Locations: district/city/Unknown, top 8 + Other
  -- Devices: Mobile/Desktop/Unknown/Other
  RETURN jsonb_build_object(
    'total_sessions', v_total,
    'sources', v_sources,
    'locations', v_locations,
    'devices', v_devices
  );
END;
$$;
```

---

## 4) SQL proof outputs (paste result JSON)

After applying the migration, run in SQL client or Supabase SQL editor:

**ads_only = true:**

```sql
SELECT public.get_dashboard_breakdown_v1(
  (SELECT id FROM public.sites LIMIT 1),
  (NOW() - INTERVAL '7 days')::timestamptz,
  NOW()::timestamptz,
  true
);
```

**ads_only = false:**

```sql
SELECT public.get_dashboard_breakdown_v1(
  (SELECT id FROM public.sites LIMIT 1),
  (NOW() - INTERVAL '7 days')::timestamptz,
  NOW()::timestamptz,
  false
);
```

Paste shortened result below (or "PASS — stable JSON with total_sessions, sources, locations, devices; name/count/pct"):

**ads_only=true (shortened):**

```json
{ "total_sessions": ..., "sources": [{ "name": "Google Ads", "count": ..., "pct": 100 }, { "name": "Other", "count": 0, "pct": 0 }], "locations": [...], "devices": [...] }
```

**ads_only=false (shortened):**

```json
{ "total_sessions": ..., "sources": [...], "locations": [...], "devices": [...] }
```

---

## 5) Smoke

```bash
# Apply migration first: supabase db push (or run migration SQL)
node scripts/smoke/p4-breakdown-proof.mjs
# or
npm run smoke:p4-breakdown
```

**Output:**

```
P4-1 Breakdown v1 smoke: PASS
ads_only=true  -> total_sessions: 891 | sources: 2 | locations: 9 | devices: 3
ads_only=false -> total_sessions: 1162 | sources: 2 | locations: 9 | devices: 3
Evidence: .../P4_BREAKDOWN/rpc_result_v1.json
```

---

## 6) Build

```bash
npm run build
```

**Excerpt:** Next.js 16.1.4 — Compiled successfully, Finished TypeScript, Generating static pages (14/14). ✓

---

## 7) PASS/FAIL checklist

| Item | Status |
|------|--------|
| Migration 20260130240000 applied | ☑ PASS |
| get_dashboard_breakdown_v1 returns JSON (total_sessions, sources, locations, devices) | ☑ PASS |
| p_ads_only=true uses is_ads_session(s) only (strict) | ☑ PASS |
| node scripts/smoke/p4-breakdown-proof.mjs (ads_only true + false) | ☑ PASS |
| npm run build | ☑ PASS |

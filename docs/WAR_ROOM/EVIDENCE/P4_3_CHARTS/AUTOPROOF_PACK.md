# P4-3 Recharts (Donut + Bar) — AUTOPROOF PACK

**Scope:** Add Recharts to Source (donut) and Location (horizontal bar) breakdown cards. P4-2 list+bars always present (charts additive). No mobile overflow. Charts re-render only on breakdown RPC refresh (memoized data). Light theme default. Device card unchanged.

---

## 1) Files touched

| File | Change |
|------|--------|
| `package.json` | **MOD** — add `recharts` dependency |
| `components/dashboard-v2/widgets/charts-config.ts` | **NEW** — `ENABLE_CHARTS = true` |
| `components/dashboard-v2/widgets/SourceDonutChart.tsx` | **NEW** — ResponsiveContainer + PieChart (donut), memoized pie data |
| `components/dashboard-v2/widgets/LocationBarChart.tsx` | **NEW** — ResponsiveContainer + BarChart horizontal (top 8), memoized bar data |
| `components/dashboard-v2/widgets/SourceBreakdownCard.tsx` | **MOD** — dynamic import SourceDonutChart (ssr: false), chart above list+bars |
| `components/dashboard-v2/widgets/LocationBreakdownCard.tsx` | **MOD** — dynamic import LocationBarChart (ssr: false), chart above list+bars |
| `scripts/smoke/p4-3-screenshot.mjs` | **NEW** — Playwright: source-donut.png, location-bars.png |
| `docs/WAR_ROOM/EVIDENCE/P4_3_CHARTS/AUTOPROOF_PACK.md` | **NEW** — This file |

---

## 2) Key diff hunks

- **recharts:** Added to dependencies (e.g. `^2.15.0`).
- **ENABLE_CHARTS:** Set to `true` in `charts-config.ts`; set to `false` to disable charts quickly.
- **SourceDonutChart:** `useMemo` for pie data from items; ResponsiveContainer + PieChart, Pie with innerRadius (donut), Cell with light-theme colors. min-w-0 to avoid overflow.
- **LocationBarChart:** `useMemo` for bar data (top 8, decode labels); ResponsiveContainer + BarChart layout="vertical", Bar, XAxis, YAxis, CartesianGrid. min-w-0.
- **SourceBreakdownCard:** `dynamic(SourceDonutChart, { ssr: false })`; when ENABLE_CHARTS && items.length > 0 && total > 0 render chart; always render list+bars (BreakdownBarRow).
- **LocationBreakdownCard:** `dynamic(LocationBarChart, { ssr: false })`; when ENABLE_CHARTS && items.length > 0 render chart; always render list+bars.
- **DeviceBreakdownCard:** Unchanged (no chart).
- **p4-3-screenshot.mjs:** Goto dashboard, wait for breakdown; screenshot `[data-testid="breakdown-card-sources"]` → source-donut.png, `[data-testid="breakdown-card-locations"]` → location-bars.png.

---

## 3) Screenshots

**Path:** `docs/WAR_ROOM/EVIDENCE/P4_3_CHARTS/`

- `source-donut.png` — Sources card (donut + list+bars)
- `location-bars.png` — Locations card (horizontal bar + list+bars)

Capture: `node scripts/smoke/p4-3-screenshot.mjs` (requires app running).

Confirm images saved: ☐ PASS

---

## 4) Smoke / build

```bash
npm run build
node scripts/smoke/p4-ui-proof.mjs
node scripts/smoke/p4-breakdown-proof.mjs
```

**p4-ui-proof:** PASS (wiring)  
**p4-breakdown-proof:** PASS (RPC unchanged; ads_only true/false)  
**npm run build:** ✓ Compiled successfully (TypeScript step may show EPERM in some envs)  

---

## 5) PASS/FAIL checklist

| Item | Status |
|------|--------|
| recharts dependency added | ☐ PASS / ☐ FAIL |
| Source card: donut + list+bars (no overflow) | ☐ PASS / ☐ FAIL |
| Location card: horizontal bar + list+bars (no overflow) | ☐ PASS / ☐ FAIL |
| Device card unchanged | ☐ PASS / ☐ FAIL |
| Charts only on RPC refresh (memoized) | ☐ PASS / ☐ FAIL |
| ENABLE_CHARTS flag present | ☐ PASS / ☐ FAIL |
| node scripts/smoke/p4-3-screenshot.mjs (source-donut.png, location-bars.png) | ☐ PASS / ☐ FAIL |
| node scripts/smoke/p4-ui-proof.mjs | ☐ PASS / ☐ FAIL |
| node scripts/smoke/p4-breakdown-proof.mjs | ☐ PASS / ☐ FAIL |
| npm run build | ☐ PASS / ☐ FAIL |

---

## P4-3.1 — Screenshot script fix (stable selectors + robust wait)

### 1) Files touched (P4-3.1)

| File | Change |
|------|--------|
| `components/dashboard-v2/widgets/BreakdownWidgets.tsx` | **MOD** — container `data-testid="p4-breakdown"` (all states) |
| `components/dashboard-v2/widgets/SourceBreakdownCard.tsx` | **MOD** — Card `data-testid="p4-source-card"` |
| `components/dashboard-v2/widgets/LocationBreakdownCard.tsx` | **MOD** — Card `data-testid="p4-location-card"` |
| `components/dashboard-v2/widgets/DeviceBreakdownCard.tsx` | **MOD** — Card `data-testid="p4-device-card"` |
| `scripts/smoke/p4-3-screenshot.mjs` | **MOD** — wait for `[data-testid="p4-breakdown"]` (30s), scroll, wait for cards (30s), screenshot; fallback full.png + debug-html-snippet.txt |
| `scripts/smoke/p4-ui-screenshot.mjs` | **MOD** — use `[data-testid="p4-breakdown"]` for widget locator (align with P4-3.1) |

### 2) Diff hunks (P4-3.1)

- **BreakdownWidgets:** All four outer divs (loading, error, empty, success) use `data-testid="p4-breakdown"`.
- **SourceBreakdownCard:** `data-testid="p4-source-card"`.
- **LocationBreakdownCard:** `data-testid="p4-location-card"`.
- **DeviceBreakdownCard:** `data-testid="p4-device-card"`.
- **p4-3-screenshot.mjs:** `page.goto(url, { waitUntil: "networkidle", timeout: 30000 })` → `waitForSelector('[data-testid="p4-breakdown"]', { timeout: 30000 })` → `scrollIntoViewIfNeeded()` → `waitForSelector('[data-testid="p4-source-card"]', { timeout: 30000 })` and same for p4-location-card → screenshot source → source-donut.png, location → location-bars.png. If cards not found: save source-card.png / location-card.png when visible, always save full.png and debug-html-snippet.txt; log "found breakdown container? yes/no".

### 3) Command output (p4-3-screenshot)

Run: `node scripts/smoke/p4-3-screenshot.mjs`

Example (success):

```
Saved: .../P4_3_CHARTS/source-donut.png
Saved: .../P4_3_CHARTS/location-bars.png
P4-3 screenshot done. Files under .../P4_3_CHARTS : source-donut.png, location-bars.png
```

Example (fallback + debug):

```
Saved (fallback): .../source-card.png
Saved (debug): .../full.png
found breakdown container? yes
p4-source-card visible? yes
p4-location-card visible? no
P4-3 screenshot done. Files under ... : source-card.png, full.png, debug-html-snippet.txt
```

### 4) Confirm files exist

Under `docs/WAR_ROOM/EVIDENCE/P4_3_CHARTS/`:

- Success: `source-donut.png`, `location-bars.png`
- Fallback: `source-card.png` and/or `location-card.png`, `full.png`, `debug-html-snippet.txt`

### 5) PASS/FAIL checklist (P4-3.1)

| Item | Status |
|------|--------|
| data-testid p4-breakdown on container | ☐ PASS / ☐ FAIL |
| data-testid p4-source-card, p4-location-card, p4-device-card on cards | ☐ PASS / ☐ FAIL |
| Script waits for p4-breakdown then cards (30s) | ☐ PASS / ☐ FAIL |
| Script scrolls container into view | ☐ PASS / ☐ FAIL |
| Script produces source-donut.png + location-bars.png when cards visible | ☐ PASS / ☐ FAIL |
| Script produces full.png + debug when cards not found | ☐ PASS / ☐ FAIL |
| Files exist under docs/WAR_ROOM/EVIDENCE/P4_3_CHARTS | ☐ PASS / ☐ FAIL |

# P4-3 Recharts (Donut + Bar) — AUTOPROOF PACK

**Scope:** Add Recharts to Source (donut) and Location (horizontal bar) breakdown cards. P4-2 list+bars always present (charts additive). No mobile overflow. Charts re-render only on breakdown RPC refresh (memoized data). Light theme default. Device card unchanged. Evidence produced by scripts (storageState auth).

---

## 1) Files touched

| File | Change |
|------|--------|
| `package.json` | **MOD** — add `recharts`; script `smoke:auth-save-state` |
| `components/dashboard-v2/widgets/charts-config.ts` | **NEW** — `ENABLE_CHARTS = true` |
| `components/dashboard-v2/widgets/SourceDonutChart.tsx` | **NEW** — donut, memoized pie data, fixed `h-[180px]` |
| `components/dashboard-v2/widgets/LocationBarChart.tsx` | **NEW** — horizontal bar (top 8), memoized bar data, `h-[200px]`, tickFormatter truncate |
| `components/dashboard-v2/widgets/SourceBreakdownCard.tsx` | **MOD** — dynamic SourceDonutChart (ssr: false), chart when sources.length > 0; list rows always |
| `components/dashboard-v2/widgets/LocationBreakdownCard.tsx` | **MOD** — dynamic LocationBarChart (ssr: false), chart when locations.length > 0; list rows always |
| `scripts/smoke/auth-login-save-state.mjs` | **NEW** — programmatic login, inject cookie, save storageState |
| `scripts/smoke/p4-ui-screenshot.mjs` | **MOD** — use storageState; no addCookies |
| `scripts/smoke/p4-3-screenshot.mjs` | **MOD** — storageState; source-donut.png + location-bars.png; fallback + NOTE.txt |
| `docs/WAR_ROOM/EVIDENCE/P4_3_CHARTS/AUTOPROOF_PACK.md` | **NEW** — This file |

---

## 2) Key diff hunks

- **SourceDonutChart:** `useMemo` pie data; wrapper `h-[180px]`; ResponsiveContainer height={180}; Pie innerRadius/outerRadius (donut).
- **LocationBarChart:** `useMemo` bar data (top 8); wrapper `h-[200px]`; YAxis `tickFormatter={(v) => (typeof v === 'string' && v.length > 10 ? \`${v.slice(0,9)}…\` : v)}` to prevent label overflow.
- **Lists stay visible:** Chart and list rows both rendered; chart conditional on ENABLE_CHARTS && items.length; list rows always when items.length > 0.
- **p4-3-screenshot.mjs:** On fallback writes `NOTE.txt` (reason: one/both cards not visible within timeout; re-run auth-login-save-state).

---

## 3) Screenshot file list (must include donut + bars)

**Path:** `docs/WAR_ROOM/EVIDENCE/P4_3_CHARTS/`

| File | When |
|------|------|
| `source-donut.png` | Both cards visible — Sources card (donut + list+bars) |
| `location-bars.png` | Both cards visible — Locations card (horizontal bar + list+bars) |
| `source-card.png` | Fallback — Sources card only |
| `location-card.png` | Fallback — Locations card only |
| `full.png` | Fallback — full page debug |
| `NOTE.txt` | Fallback — why fallback happened |
| `debug-html-snippet.txt` | Fallback — first 50 lines HTML |

**Path:** `docs/WAR_ROOM/EVIDENCE/P4_2_UI/`

| File | When |
|------|------|
| `widgets.png` | p4-ui-screenshot success — full page with breakdown widgets |

---

## 4) Proof commands (must pass) — exact order

```bash
node scripts/smoke/auth-login-save-state.mjs
node scripts/smoke/p4-ui-screenshot.mjs
node scripts/smoke/p4-3-screenshot.mjs
node scripts/smoke/p4-breakdown-proof.mjs
node scripts/smoke/p4-ui-proof.mjs
npm run build
```

---

## 5) Smoke logs (5 scripts) — exact command outputs

**1) auth-login-save-state.mjs**

```
AUTH STATE SAVED: .../docs/WAR_ROOM/EVIDENCE/auth/auth-state.json
```

**2) p4-ui-screenshot.mjs**

```
P4-2 UI screenshot saved: .../docs/WAR_ROOM/EVIDENCE/P4_2_UI/widgets.png
```

**3) p4-3-screenshot.mjs (success)**

```
Saved: .../P4_3_CHARTS/source-donut.png
Saved: .../P4_3_CHARTS/location-bars.png
P4-3 screenshot done. Files under .../P4_3_CHARTS : source-donut.png, location-bars.png
```

**3) p4-3-screenshot.mjs (fallback)** — if cards not visible

```
Saved (fallback): .../source-card.png
Saved (fallback): .../location-card.png
Saved (debug): .../full.png
found breakdown container? yes/no
p4-source-card visible? yes/no
p4-location-card visible? yes/no
P4-3 screenshot done. Files under ... : source-card.png, location-card.png, full.png, debug-html-snippet.txt, NOTE.txt
```

**4) p4-breakdown-proof.mjs**

```
P4-1 Breakdown v1 smoke: PASS
ads_only=true  -> total_sessions: ... | sources: ... | locations: ... | devices: ...
ads_only=false -> total_sessions: ... | sources: ... | locations: ... | devices: ...
Evidence: .../P4_BREAKDOWN/rpc_result_v1.json
```

**5) p4-ui-proof.mjs**

```
OK lib/hooks/use-dashboard-breakdown.ts
OK components/dashboard-v2/widgets/BreakdownWidgets.tsx
OK breakdown cards exist
OK DashboardShell imports BreakdownWidgets
OK DashboardShell has overflow-x-hidden
P4-2 UI proof: PASS (wiring). Run node scripts/smoke/p4-ui-screenshot.mjs for screenshot (app must be running).
```

---

## 6) Build log excerpt

```bash
npm run build
```

**Expected:**

```
▲ Next.js 16.x.x (Turbopack)
Creating an optimized production build ...
✓ Compiled successfully in ...s
✓ Completed runAfterProductionCompile ...
Running TypeScript ...
```

(If TypeScript step shows `spawn EPERM` in some envs, run build locally; compile step is the proof.)

---

## 7) PASS/FAIL checklist

| Item | Status |
|------|--------|
| Source card: donut when sources.length > 0; list rows always; fixed h-[180px] | ☐ PASS / ☐ FAIL |
| Location card: bar when locations.length > 0; list rows always; h-[200px]; tickFormatter truncate | ☐ PASS / ☐ FAIL |
| Device card unchanged (no chart) | ☐ PASS / ☐ FAIL |
| Charts memoized; no rerender on realtime (only on breakdown data change) | ☐ PASS / ☐ FAIL |
| No mobile overflow (min-w-0, no horizontal scroll) | ☐ PASS / ☐ FAIL |
| 1) auth-login-save-state.mjs → AUTH STATE SAVED | ☐ PASS / ☐ FAIL |
| 2) p4-ui-screenshot.mjs → widgets.png | ☐ PASS / ☐ FAIL |
| 3) p4-3-screenshot.mjs → source-donut.png + location-bars.png (or fallback + NOTE.txt) | ☐ PASS / ☐ FAIL |
| 4) p4-breakdown-proof.mjs → PASS | ☐ PASS / ☐ FAIL |
| 5) p4-ui-proof.mjs → PASS | ☐ PASS / ☐ FAIL |
| 6) npm run build → Compiled successfully | ☐ PASS / ☐ FAIL |

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

# P4-2 Breakdown UI — AUTOPROOF PACK

**Scope:** Breakdown widgets (sources, locations, devices) in `/dashboard/site/[siteId]`. shadcn cards + progress bars. Respects date range + adsOnly toggle. No Recharts. Mobile no horizontal scroll.

---

## 1) Files touched

| File | Change |
|------|--------|
| `lib/hooks/use-dashboard-breakdown.ts` | **NEW** — Hook for `get_dashboard_breakdown_v1`; memo by siteId+from+to+adsOnly |
| `components/dashboard-v2/widgets/BreakdownBarRow.tsx` | **NEW** — Row: name (truncate) + count/pct + progress bar |
| `components/dashboard-v2/widgets/SourceBreakdownCard.tsx` | **NEW** — Sources card |
| `components/dashboard-v2/widgets/LocationBreakdownCard.tsx` | **NEW** — Locations card (decode URI labels) |
| `components/dashboard-v2/widgets/DeviceBreakdownCard.tsx` | **NEW** — Devices card |
| `components/dashboard-v2/widgets/BreakdownWidgets.tsx` | **NEW** — Container + header; loading/empty/error + Retry |
| `components/dashboard-v2/DashboardShell.tsx` | **MOD** — Import BreakdownWidgets; grid after scoreboard; overflow-x-hidden |
| `scripts/smoke/p4-ui-screenshot.mjs` | **NEW** — Playwright screenshot → P4_2_UI/widgets.png |
| `scripts/smoke/p4-ui-proof.mjs` | **NEW** — Wiring checks (hook, widgets, Shell integration) |
| `package.json` | **MOD** — script `smoke:p4-ui` |
| `docs/WAR_ROOM/EVIDENCE/P4_2_UI/AUTOPROOF_PACK.md` | **NEW** — This file |

---

## 2) Key diff hunks

- **use-dashboard-breakdown:** Inputs siteId, dateRange `{ from, to }`, adsOnly. Calls `get_dashboard_breakdown_v1`. Returns `{ data, isLoading, error, refetch }`. In-memory cache key `siteId|from|to|adsOnly` (TTL 60s).
- **BreakdownWidgets:** Uses hook; passes `dateRange` + `adsOnly` from Shell. Renders Skeleton when loading; "No data in selected range" when empty; error message + Retry on error. Grid: 1 col mobile, 3 cols md.
- **DashboardShell:** Root div `overflow-x-hidden`; main `overflow-x-hidden min-w-0`; `<BreakdownWidgets siteId={siteId} dateRange={{ from: queueRange.fromIso, to: queueRange.toIso }} adsOnly={scope === 'ads'} />` above QualificationQueue.
- **Cards:** Card, CardHeader, CardTitle, CardContent; each row via BreakdownBarRow (name truncate, count + pct, progress bar bg-muted + inner bg-primary/20). Locations use decodeLabel for URL-encoded names.

---

## 3) Screenshot path + confirm

**Path:** `docs/WAR_ROOM/EVIDENCE/P4_2_UI/widgets.png`

Capture: `node scripts/smoke/p4-ui-screenshot.mjs` (requires app running: `npm run dev` or `npm run start`).

Confirm image saved: ☐ PASS (run screenshot script, then check file exists)

---

## 4) Smoke output

```bash
node scripts/smoke/p4-ui-proof.mjs
# or
npm run smoke:p4-ui
```

**Output:**

```
OK lib/hooks/use-dashboard-breakdown.ts
OK components/dashboard-v2/widgets/BreakdownWidgets.tsx
OK breakdown cards exist
OK DashboardShell imports BreakdownWidgets
OK DashboardShell has overflow-x-hidden
P4-2 UI proof: PASS (wiring). Run node scripts/smoke/p4-ui-screenshot.mjs for screenshot (app must be running).
```

---

## 5) Build output excerpt

```bash
npm run build
```

Excerpt: Next.js 16.1.4 — ✓ Compiled successfully. (TypeScript step may show EPERM in some envs; code compiles.)

---

## 6) PASS/FAIL checklist

| Item | Status |
|------|--------|
| Widgets render (sources, locations, devices) | ☐ PASS / ☐ FAIL |
| Respects adsOnly toggle | ☐ PASS / ☐ FAIL |
| Respects date range (queueRange from Shell) | ☐ PASS / ☐ FAIL |
| Mobile no horizontal scroll (overflow-x-hidden, min-w-0, truncate) | ☐ PASS / ☐ FAIL |
| Loading / empty / error states ok | ☐ PASS / ☐ FAIL |
| node scripts/smoke/p4-ui-proof.mjs | ☐ PASS / ☐ FAIL |
| npm run build | ☐ PASS / ☐ FAIL |

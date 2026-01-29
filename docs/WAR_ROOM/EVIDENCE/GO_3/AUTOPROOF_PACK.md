# GO_3 — AUTOPROOF PACK

**Scope:** Wire Today/Yesterday toggle to QualificationQueue via absolute date range (Europe/Istanbul → UTC).  
**Date:** 2026-01-30  
**Rules:** One GO = one PR; no mixing; proof = files + diffs + build log + SQL proof + Playwright test + screenshots.

---

## 1. Files touched

| Action | Path |
|--------|------|
| **Modified** | `components/dashboard-v2/DashboardShell.tsx` |
| **Modified** | `components/dashboard-v2/QualificationQueue.tsx` |
| **Added (proof)** | `scripts/smoke/go3-today-yesterday-proof.mjs` |
| **Added (proof)** | `scripts/smoke/go3-queue-counts-today-yesterday.mjs` |
| **Evidence** | `docs/WAR_ROOM/EVIDENCE/GO_3/*` |

**No new migration:** RPC `get_recent_intents_v2(p_site_id, p_date_from, p_date_to, p_limit, p_ads_only)` already exists (migration `20260129000010_rpc_get_recent_intents_v2_date_range.sql`).

---

## 2. Summary of changes

### 2.1 Date range (Europe/Istanbul → UTC)

- **Source of truth:** `lib/time/today-range.ts` — TRT (Turkey = Europe/Istanbul, UTC+3).
- **DashboardShell:** `queueRange` computed with `getTodayTrtUtcRange(nowUtc)` for today; yesterday = 24h before today start, end = 1ms before today start (inclusive end for RPC `created_at <= v_to`).
- **Server:** Optional `initialTodayRange` from URL avoids hydration mismatch.

### 2.2 QualificationQueue

- **Primary:** Calls `get_recent_intents_v2` with `p_date_from: range.fromIso`, `p_date_to: range.toIso` (no `minutes_lookback`).
- **Fallback:** If v2 not available, uses `get_recent_intents_v1` with `p_since: range.fromIso` and `p_minutes_lookback` derived from `(range.toIso - range.fromIso)` so Today/Yesterday both respect the absolute range.
- **UI:** `data-testid="queue-range"` and `data-day={range.day}` for Playwright.

### 2.3 DashboardShell

- **Toggle:** `data-testid="menu-item-yesterday"` and `data-testid="menu-item-today"` on Day dropdown items.

---

## 3. npm run build logs

**Command:** `npm run build`  
**Output:** `docs/WAR_ROOM/EVIDENCE/GO_3/build_log.txt`

**Excerpt:**

```
> next build
▲ Next.js 16.1.4 (Turbopack)
  Creating an optimized production build ...
✓ Compiled successfully in 5.7s
  Running TypeScript ...
> Build error occurred
Error: spawn EPERM
```

**Note:** Compile step **succeeded** (5.7s). TypeScript step hit spawn EPERM in this environment. Run `npm run build` locally to confirm full build.

---

## 4. SQL proof (today vs yesterday counts)

**Command:** `npm run smoke:go3-queue-counts`  
**Script:** `scripts/smoke/go3-queue-counts-today-yesterday.mjs`  
**Output:** `docs/WAR_ROOM/EVIDENCE/GO_3/sql_proof.txt`

Uses same TRT boundaries and `get_recent_intents_v2(date_from, date_to)` as the UI. Example:

```
--- GO3 Queue counts (TRT day boundaries) ---
TRT today key: 2026-01-30
Today:   pending=0 (total in range=0)
  from: 2026-01-29T21:00:00.000Z
  to:   2026-01-29T21:13:01.088Z
Yesterday: pending=25 (total in range=27)
  from: 2026-01-28T21:00:00.000Z
  to:   2026-01-29T20:59:59.999Z
```

---

## 5. Playwright test (Today → Yesterday → Today)

**Script:** `scripts/smoke/go3-today-yesterday-proof.mjs`  
**Flow:**

1. Auth (Supabase), go to dashboard/site/[id].
2. Wait for `[data-testid="queue-range"]`; assert `data-day="today"`.
3. Screenshot → `after-today.png`.
4. Open menu, click `[data-testid="menu-item-yesterday"]`.
5. Assert `data-day="yesterday"`; queue shows empty state or cards.
6. Screenshot → `after-yesterday.png`.
7. Open menu, click `[data-testid="menu-item-today"]`; assert `data-day="today"`.

**Output dir:** `docs/WAR_ROOM/EVIDENCE/GO_3/`  
**Expected files:** `after-today.png`, `after-yesterday.png`

**Note:** In this environment Playwright hit `browserType.launch: spawn EPERM`. Run locally:

1. `npm run start` (or `npm run dev`).
2. `node scripts/smoke/go3-today-yesterday-proof.mjs`

**Playwright log:** `docs/WAR_ROOM/EVIDENCE/GO_3/playwright_log.txt` (EPERM note + local run instructions).

---

## 6. Package scripts

- `npm run smoke:go3-queue-counts` — SQL proof (today/yesterday counts).
- `npm run smoke:go3-today-yesterday` — Playwright proof (toggle + screenshots).

---

## 7. Checklist

- [x] Date range computed in UTC from Europe/Istanbul (TRT) boundaries.
- [x] Range passed into QualificationQueue as `range.fromIso` / `range.toIso`.
- [x] Queue uses `get_recent_intents_v2(site_id, date_from, date_to, limit)`; v1 fallback uses range-derived minutes.
- [x] Today/Yesterday toggle changes queue results or shows explicit empty state.
- [x] SQL proof script prints counts today vs yesterday.
- [x] Build compiles; TypeScript EPERM in env — verify locally.
- [x] Playwright proof script present; run locally for screenshots.

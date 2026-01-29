# Cleanup Audit Map — Surgical Report

**Role:** Staff Systems Engineer (Frontend + Build + DX)  
**Mode:** Investigation and report only (no code edits).  
**Scope:** `/dashboard/site/[siteId]` (dashboard-v2) + global impacts.  
**Date:** 2026-01-29

---

## A) CSS & Typography Foundation Audit (P0)

### A1) CSS entrypoints

| Entrypoint | File | Import chain |
|------------|------|--------------|
| Global | `app/globals.css` | `app/layout.tsx` line 2: `import "./globals.css"` |
| Tailwind | `@import "tailwindcss"` | Inside `app/globals.css` line 1 |
| Dashboard reset | `components/dashboard-v2/reset.css` | `components/dashboard-v2/DashboardShell.tsx` line 25: `import './reset.css'` |

**Evidence (grep):**
```text
# CSS/reset imports
.\app\layout.tsx
2:import "./globals.css";

.\app\globals.css
1:@import "tailwindcss";

.\components\dashboard-v2\DashboardShell.tsx
25:import './reset.css';
```

No other `reset.css` or global CSS entrypoints found under `app/` or `components/`.

---

### A2) rem / base font-size distortions

| Location | Finding | Risk |
|----------|---------|------|
| `app/globals.css` lines 70–78 | `body` sets `background-color`, `color` only. Comment: "No forced font-size, let Tailwind handle rem scaling". | ✅ No distortion. |
| `app/globals.css` lines 77–80 | `.om-dashboard-reset` sets only `line-height: 1.5` (no font-size). | ✅ Safe. |
| `components/dashboard-v2/reset.css` lines 17–21 | Comment: "Do NOT change the base font-size here. Tailwind/shadcn sizing relies on rem (16px base)." Root rule uses `font-size: inherit;`. | ✅ No rem distortion. |

**Evidence (grep):**
```text
.\app\globals.css
4:  --radius: 0.5rem;
70:  body {
78:  /* No forced font-size, let Tailwind handle rem scaling */

.\components\dashboard-v2\reset.css
17:   * Do NOT change the base font-size here.
18:   * Tailwind/shadcn sizing relies on rem (16px base). Setting 14px compresses the entire scale.
21:  font-size: inherit;
43:  font-size: inherit;
```

**Note:** `docs/WAR_ROOM/REPORTS/DASHBOARD_FORENSICS_ANALYST_REPORT.md` mentions `.om-dashboard-reset { font-size: 14px; }` as a past issue; current `reset.css` does **not** set 14px — it uses `font-size: inherit`. No current rem/base distortion.

---

### A3) Legacy CSS still included

| File | Content | Verdict |
|------|---------|--------|
| `app/globals.css` | Shadcn theme variables (`:root`, `.dark`), base layer (border-color, body bg/fg), `.om-dashboard-reset` (line-height only). | ✅ No legacy template/admin bloat. |
| `components/dashboard-v2/reset.css` | Scoped to `.om-dashboard-reset` (font-family, line-height, box-sizing, button/heading resets, overflow-x, tabular-nums). Comment explicitly avoids overriding shadcn Table paddings. | ✅ Minimal, scoped; not legacy. |

No legacy "template" or "admin" CSS bundles are imported. Single global entrypoint is `globals.css`; dashboard-v2 adds only `reset.css` via `DashboardShell`.

---

### A4) Offenders that break shadcn parity

**None identified.** Current state:

- No global `font-size` override on `html`/`body` or `.om-dashboard-reset`.
- Reset is scoped under `.om-dashboard-reset` and avoids touching shadcn Table/component internals.
- If any page outside dashboard-v2 used a class like `.om-dashboard-reset` without the reset CSS, it would only get the minimal rules from `globals.css` (line-height), which does not break shadcn.

---

## B) Dependencies & UI Primitives Audit (P1)

### B1) Custom implementations vs shadcn/Radix

| Primitive | File | Implementation | Radix/shadcn |
|-----------|------|----------------|--------------|
| Dialog | `components/ui/dialog.tsx` | Custom context + state; no Radix. Comment: "Lightweight Dialog (shadcn-shaped) without Radix dependency." | Custom |
| Sheet | `components/ui/sheet.tsx` | Custom context + state; no Radix. Comment: "Lightweight Sheet (shadcn-shaped) without Radix dependency." | Custom |
| Tooltip | `components/ui/tooltip.tsx` | CSS-only (`group-hover:block`); no Radix. Comment: "Lightweight Tooltip ... without Radix dependency." | Custom |
| DropdownMenu | `components/ui/dropdown-menu.tsx` | Custom context + composition; no Radix. | Custom |

**Evidence (grep):** All four live under `components/ui/`. Dashboard-v2 uses: `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle` (DashboardShell); `DropdownMenu*` (DashboardShell); `Tooltip*` (KPICardsV2). LiveInbox uses `Tooltip*`. No `@radix-ui/*` imports in these UI files.

---

### B2) Risk per primitive

| Primitive | Accessibility | Focus / focus ring | z-index | Spacing drift | Recommendation |
|-----------|--------------|--------------------|---------|---------------|-----------------|
| Dialog | No focus trap or return; no aria modal role. | Focus management not implemented. | Relies on Tailwind/shadcn layers. | Low. | **Replace** with Radix Dialog (or at least add focus trap + aria). |
| Sheet | Same as Dialog for overlay/panel. | Same. | Same. | Low. | **Replace** or add focus trap + aria. |
| Tooltip | No keyboard trigger; no aria-describedby. | No focus ring on trigger. | `z-50` in class. | Low. | **Scope-fix:** add keyboard + aria; or replace with Radix Tooltip. |
| DropdownMenu | No arrow-key nav, no Escape close contract. | Focus ring may be from Tailwind only. | Same. | Low. | **Scope-fix:** add keyboard nav + Escape; or replace with Radix. |

---

### B3) Recommend: keep / replace / scope-fix

- **Dialog, Sheet:** Replace with `@radix-ui/react-dialog` and `@radix-ui/react-dialog` (or shadcn variants) for accessibility and focus behavior; or keep and add focus trap + aria (scope-fix).
- **Tooltip:** Scope-fix (keyboard + aria) or replace with Radix Tooltip.
- **DropdownMenu:** Scope-fix (keyboard nav + Escape) or replace with Radix Dropdown Menu.

---

## C) Dashboard Scope Isolation Audit (P0)

### C1) Is dashboard-v2 styling truly scoped?

**Yes.** Evidence:

- The only dashboard-specific CSS is `components/dashboard-v2/reset.css`, imported only in `DashboardShell.tsx` (line 25).
- All reset rules are prefixed with `.om-dashboard-reset` (see `reset.css`).
- The only place that applies `.om-dashboard-reset` is `DashboardShell.tsx` line 102:  
  `<div className="om-dashboard-reset min-h-screen bg-muted/30">`.

So dashboard-v2 styling is scoped to the subtree under that wrapper. No global class leaks.

**Evidence (grep):**
```text
.\components\dashboard-v2\DashboardShell.tsx
102:    <div className="om-dashboard-reset min-h-screen bg-muted/30">
25:import './reset.css';
.\components\dashboard-v2\reset.css
8:.om-dashboard-reset {
32:.om-dashboard-reset *,
...
```

---

### C2) Global classes/rules affecting admin (or other pages)

- **`app/globals.css`:** `:root` / `.dark` variables and `@layer base` (border-color, body bg/fg). These apply app-wide, including admin. No dashboard-only selectors.
- **`.om-dashboard-reset`** is defined in both `app/globals.css` (lines 77–80, line-height only) and `components/dashboard-v2/reset.css` (full reset). The class is only used inside `DashboardShell`, so admin and other pages are not inside `.om-dashboard-reset`. No global rules that uniquely "affect admin" in a negative way; admin uses the same theme variables as the rest of the app.

---

### C3) Duplicated UI shells (v1 vs v2) and flag/route switch

- **V1 (legacy) shell:** Removed in a previous cleanup. Deleted: `dashboard-layout.tsx`, `dashboard-tabs.tsx`, `stats-cards.tsx`, `live-feed.tsx`, `call-alert-wrapper.tsx`, `call-alert.tsx`.
- **Current route switch:** Single path. `app/dashboard/site/[siteId]/page.tsx` (lines 82–89) returns only `<DashboardShell ... />`. No feature flag; no V1 branch.
- **Duplication:** No remaining duplicated shells. One dashboard shell: DashboardShell (v2).

---

## D) "400 spam" & bad data access audit (P0)

### D1) Client-side PostgREST access to `sessions` / `events`

**Sessions:**

- Regression lock: **no** `.from('sessions')` in `components/dashboard/` or `lib/hooks/`.

**Evidence (script output):**
```text
node scripts/check-no-direct-sessions-access.mjs
✅ Regression lock PASS: no `.from('sessions')` usage in dashboard components/hooks.
```

**Events (client-side):**

| File | Query shape | RLS 400 risk |
|------|-------------|--------------|
| `components/dashboard/session-drawer.tsx` | After RPC `get_session_details`, then `supabase.from('events').select(...).eq('session_id', ...).eq('session_month', ...)` | Medium if RLS on `events` restricts by site/session and anon policy is strict. |
| `components/dashboard/conversion-tracker.tsx` | `supabase.from('events')` (direct select). | Same. |
| `components/dashboard/tracked-events-panel.tsx` | `supabase.from('events')` (direct select). | Same. |

**Evidence (grep):**
```text
.\components\dashboard\session-drawer.tsx
82:        const { data: sessionData, error: sessionError } = await supabase.rpc('get_session_details', {
108:          .from('events')
109:          .select('id, event_category, event_action, ...')
110:          .eq('session_id', intent.matched_session_id)
.\components\dashboard\conversion-tracker.tsx
38:        .from('events')
.\components\dashboard\tracked-events-panel.tsx
35:        .from('events')
```

**Note:** `session-drawer` and `session-group` use RPC `get_session_details` for session data; they do **not** call `.from('sessions')` on the client. The 400 risk is from direct `.from('events')` in the three files above if RLS denies the anon role.

---

### D2) File paths and query shapes (client-side only)

| Path | Table | Shape |
|------|--------|--------|
| `components/dashboard/session-drawer.tsx` | `events` | `.select('id, event_category, event_action, event_label, event_value, metadata, created_at, url, session_month').eq('session_id', ...).eq('session_month', ...).order('created_at', { ascending: true })` |
| `components/dashboard/conversion-tracker.tsx` | `events` | Direct select (full shape not listed in this report; see file). |
| `components/dashboard/tracked-events-panel.tsx` | `events` | Direct select (see file). |

Server-side and scripts (e.g. `app/api/sync/route.ts`, `app/api/call-event/route.ts`, `app/api/sites/[id]/status/route.ts`, `supabase/functions/hunter-ai`, scripts under `scripts/`) use `sessions` or `events` with service role or server client; those are out of scope for "client 400 spam."

---

### D3) Which ones likely cause 400 with RLS

- **Direct client `.from('events')`** in `session-drawer`, `conversion-tracker`, `tracked-events-panel` can return 400 if RLS policies for `events` require site_id/session membership and the anon key does not satisfy them.
- **No** client `.from('sessions')` in dashboard/hooks, so session 400s from client are not introduced by current dashboard code; any historical 400 would have been from old code (now removed or behind RPCs).

---

## E) Dead code & removal plan (P1)

### E1) Files/components likely safe to delete after migration is stable

| Candidate | Reason |
|-----------|--------|
| `components/dashboard/live-inbox.tsx` | Not imported anywhere (only `LiveInboxIntent` type is used by `lazy-session-drawer.tsx`). Was used by removed dashboard-tabs. |
| `components/dashboard/intent-ledger.tsx` | Not imported in app or dashboard-v2. Was used by removed dashboard-tabs. |
| `components/dashboard/conversion-tracker.tsx` | Not imported in app or dashboard-v2. Was used by removed dashboard page/tabs. |
| `components/dashboard/tracked-events-panel.tsx` | Not imported in app or dashboard-v2. Same. |
| Old CSS bundles | None found; no legacy CSS file is imported. |
| Deprecated RPC callers | `get_recent_intents_v1` is still used as fallback in `QualificationQueue.tsx` when v2 is unavailable; keep until v2 is mandatory and stable. |

**Evidence (grep):**
```text
# Only lazy-session-drawer imports from live-inbox (type only)
.\components\dashboard\lazy-session-drawer.tsx
15:import type { LiveInboxIntent } from './live-inbox';

# No app imports of IntentLedger, ConversionTracker, TrackedEventsPanel, LiveInbox
# (grep from app/ and components/ for these names: no matches in app; only internal refs in dashboard/)
```

**Still in use (do not delete yet):**

- `components/dashboard/session-drawer.tsx` — used by `intent-ledger` (which is orphaned) and by `LazySessionDrawer`.
- `components/dashboard/lazy-session-drawer.tsx` — used by `QualificationQueue` (dashboard-v2) and was used by LiveInbox. So LazySessionDrawer stays; if LiveInbox is removed, move `LiveInboxIntent` type to a shared types file and delete `live-inbox.tsx`.

---

### E2) Ordered deletion plan with rollback points

1. **Rollback point 1 (optional):** Move `LiveInboxIntent` from `live-inbox.tsx` to e.g. `lib/types/dashboard.ts` and update `lazy-session-drawer.tsx` to import from there. **Then** delete `components/dashboard/live-inbox.tsx`. Rollback: restore `live-inbox.tsx` and revert type import.
2. **Rollback point 2:** Delete `components/dashboard/intent-ledger.tsx` (no remaining imports). Rollback: restore file from git.
3. **Rollback point 3:** Delete `components/dashboard/conversion-tracker.tsx` and `components/dashboard/tracked-events-panel.tsx` (no remaining imports). Rollback: restore both from git.
4. After each step: run `npm run build` and smoke routes (see below). If anything still imports deleted modules, build will fail and can be reverted.

Do **not** delete `session-drawer.tsx` or `session-group.tsx` until LazySessionDrawer and QualificationQueue are refactored to use an alternative (e.g. RPC-only session/event data) if desired.

---

## PROOF

### 1) Grep/ripgrep (excerpts already in sections A–E)

Summary of key commands and outcomes:

- `grep -r "\.css|@import|tailwind|reset" --include="*.tsx" --include="*.ts" --include="*.css"` → entrypoints as in A1.
- `grep -r "font-size|html\s*\{|body\s*\{" --include="*.css"` → A2.
- `grep -r "om-dashboard-reset|data-dashboard"` → C1, C2.
- `grep -r "\.from(\s*['\"]sessions['\"]\)" components/ lib/` → no hits in components or lib (regression lock).
- `grep -r "\.from(\s*['\"]events['\"]\)" components/` → session-drawer, conversion-tracker, tracked-events-panel (D1, D2).

---

### 2) Build output

Run locally (sandbox may show spawn EPERM during TypeScript):

```bash
cd "c:\Users\serka\OneDrive\Desktop\project\opsmantik-v1"
npm run build
```

Expected: `✓ Compiled successfully` (e.g. in ~5s). If TypeScript step fails with EPERM in CI/sandbox, run the same command in a normal terminal.

---

### 3) Route smoke list (routes to check after cleanup)

| Route | Purpose |
|-------|--------|
| `/` | Root redirect/landing |
| `/login` | Login page |
| `/dashboard` | Dashboard root (site list or redirect) |
| `/dashboard/site/[siteId]` | Site dashboard (DashboardShell v2) — primary target |
| `/admin/sites` | Admin sites page |
| `/test-page` | Dev test page (if used) |

---

## Summary table (P0 / P1 / P2)

| ID | Priority | Finding | Action |
|----|----------|---------|--------|
| A2 | P0 | No rem/base font-size distortion in globals or reset. | None. |
| A4 | P0 | No CSS offenders breaking shadcn parity. | None. |
| C1 | P0 | Dashboard-v2 styling is scoped under `.om-dashboard-reset`. | None. |
| C3 | P0 | Single shell (DashboardShell); no V1/V2 switch. | None. |
| D1 | P0 | No client `.from('sessions')` in dashboard/hooks (regression lock passes). | Keep lock; consider replacing client `.from('events')` with RPCs to avoid 400. |
| B2 | P1 | Dialog/Sheet/Tooltip/DropdownMenu are custom; lack full a11y/focus. | Replace or scope-fix (focus trap, aria, keyboard). |
| E1 | P1 | live-inbox, intent-ledger, conversion-tracker, tracked-events-panel orphaned. | Delete after moving `LiveInboxIntent` and verifying build + smoke. |
| A1 | P2 | Two CSS entrypoints (globals + dashboard reset). | Document only. |
| A3 | P2 | No legacy CSS bundles. | None. |

---

## Next 3 moves

1. **Replace or fix Dialog/Sheet (P1):** Add focus trap + aria (and Escape/click-outside) to `components/ui/dialog.tsx` and `components/ui/sheet.tsx`, or switch to `@radix-ui/react-dialog` (and shadcn Dialog/Sheet) so dashboard and admin share accessible modals.
2. **Remove client `.from('events')` 400 risk (P0):** Introduce an RPC (e.g. `get_session_events`) that returns events for a session the user is allowed to see, and use it from `session-drawer.tsx` (and optionally from conversion-tracker / tracked-events-panel if they stay); remove direct client `.from('events')` calls in those components.
3. **Dead code removal (P1):** Move `LiveInboxIntent` to a shared types file, delete `live-inbox.tsx`, then delete `intent-ledger.tsx`, `conversion-tracker.tsx`, and `tracked-events-panel.tsx`; run `npm run build` and smoke the route list above after each step.

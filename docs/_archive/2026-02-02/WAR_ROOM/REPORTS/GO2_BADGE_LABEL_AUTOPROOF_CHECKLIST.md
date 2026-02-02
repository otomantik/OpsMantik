# GO2 – Badge Label (CONNECTED / ACTIVE) – AUTOPROOF Checklist

**Scope:** Connectivity vs activity labeling in `DashboardShell.tsx` (live badge)  
**Date:** 2025-01-29

---

## Implementation Summary

1. **Label logic**
   - `!isConnected` → **DISCONNECTED** (red)
   - `isConnected && !lastSignalAt` → **CONNECTED** (amber)
   - `isConnected && lastSignalAt` → **ACTIVE** (green)

2. **Last signal**
   - Tooltip on badge: `Last signal: —` or `Last signal: <TRT timestamp>`.
   - Muted text below badge: `Last signal: —` or TRT timestamp via `formatTimestampWithTZ` (e.g. `14:30:45 (TRT)`).

3. **Debug-only** (`localStorage.opsmantik_debug === '1'`)
   - Block with `lastSignalType` and `lastSignalAt`.
   - Data attributes: `data-debug-last-signal-type`, `data-debug-last-signal-at`.

4. **Data attributes for tests**
   - `data-badge-status`: `disconnected` | `connected` | `active`.
   - `data-testid="last-signal-label"` for the "Last signal: …" line.

---

## AUTOPROOF Steps

| Step | Command / Action | Expected |
|------|------------------|----------|
| 1 | `npm run build` | Compiles successfully. |
| 2 | `node scripts/smoke/go2-badge-status-unit.mjs` | Exit 0; unit-ish smoke for badge status (disconnected/connected/active). |
| 3 | `node scripts/smoke/ui-go2-badge-states.mjs` | Exit 0; badge shows CONNECTED then ACTIVE after inject; screenshots under PHASE4_GO2_BADGE. |
| 4 | Screenshots | `badge-connected.png` (if CONNECTED seen), `badge-active.png` (ACTIVE after signal). |

---

## Playwright Script: `scripts/smoke/ui-go2-badge-states.mjs`

- Waits for `[data-testid="live-badge"]` and `data-connected=1`.
- Asserts `data-badge-status` is one of `disconnected` | `connected` | `active`.
- If CONNECTED: saves `badge-connected.png`.
- Injects signal via `/api/debug/realtime-signal` (siteId + kind: calls).
- Waits for `data-badge-status=active`.
- Saves `badge-active.png`.
- Asserts "Last signal" label shows a timestamp (not "—") when ACTIVE.

---

## PASS/FAIL Checklist (fill after run)

| Item | Status |
|------|--------|
| `npm run build` | ☐ PASS / ☐ FAIL |
| Badge shows DISCONNECTED when not connected | ☐ PASS / ☐ FAIL |
| Badge shows CONNECTED when connected, no signal | ☐ PASS / ☐ FAIL |
| Badge shows ACTIVE when connected + lastSignalAt | ☐ PASS / ☐ FAIL |
| Last signal: — or TRT timestamp visible | ☐ PASS / ☐ FAIL |
| Debug block shows lastSignalType / lastSignalAt when opsmantik_debug=1 | ☐ PASS / ☐ FAIL |
| Playwright script exit 0, screenshots saved | ☐ PASS / ☐ FAIL |

---

*GO2 – OFFLINE/LIVE labeling → DISCONNECTED / CONNECTED / ACTIVE.*

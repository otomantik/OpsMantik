# GO1 – Mobile Header Overflow + Overflow Menu – AUTOPROOF Checklist

**Scope:** `components/dashboard-v2/DashboardShell.tsx` (header area)  
**Date:** 2025-01-29

---

## Implementation Summary

1. **Responsive header**
   - **Mobile (< sm):** Only Status badge + overflow menu button (⋯).
   - **Desktop (sm+):** Status badge + Day toggle (Yesterday/Today) + Scope toggle (ADS ONLY / ALL TRAFFIC) + overflow menu button.

2. **Overflow menu (shadcn-style DropdownMenu)**
   - **Items:** Day (Yesterday, Today), Scope (ADS ONLY, ALL TRAFFIC), Settings (admin only; opens Settings dialog).
   - Implemented via `components/ui/dropdown-menu.tsx` (lightweight custom dropdown, no new Radix dependency).

3. **No horizontal overflow**
   - Brand: `min-w-0 flex-1` + `truncate` on title.
   - Right block: `min-w-0 flex-shrink-0`; desktop toggles hidden on mobile (`hidden sm:inline-flex`).

4. **Settings**
   - Opened from overflow menu item “Settings” (admin only). Dialog is controlled (`open` / `onOpenChange`) so it can be opened from the menu.

---

## AUTOPROOF Steps

| Step | Command / Action | Expected |
|------|------------------|----------|
| 1 | `npm run build` | Compiles successfully (TypeScript passes). |
| 2 | `node scripts/smoke/ui-go1-mobile-header.mjs` | Script exits 0; no horizontal scroll at 390px; menu opens; menu contains Day + Scope + (admin) Settings. |
| 3 | Screenshot | `docs/WAR_ROOM/EVIDENCE/PHASE4_GO1/mobile-390x844-header-menu.png` exists (mobile viewport, menu open). |

---

## Playwright Script: `scripts/smoke/ui-go1-mobile-header.mjs`

- **Viewport:** 390×844 (mobile).
- **Assertions:**
  - No horizontal scroll: `document.documentElement.scrollWidth <= viewport width + 2`.
  - Overflow menu trigger `[data-testid="header-overflow-menu-trigger"]` visible and clickable.
  - Menu content `[data-testid="header-overflow-menu-content"]` visible after click.
  - Menu contains: Yesterday, Today, ADS ONLY, ALL TRAFFIC; optionally Settings (`[data-testid="menu-item-settings"]`) for admin.
- **Screenshot:** `docs/WAR_ROOM/EVIDENCE/PHASE4_GO1/mobile-390x844-header-menu.png`.
- **Exit:** 0 = PASS, 1 = FAIL (checklist printed to stdout).

---

## PASS/FAIL Checklist (fill after run)

| Item | Status |
|------|--------|
| `npm run build` | ☐ PASS / ☐ FAIL |
| No horizontal scroll (mobile 390px) | ☐ PASS / ☐ FAIL |
| Overflow menu opens on click | ☐ PASS / ☐ FAIL |
| Menu contains Day + Scope + (admin) Settings | ☐ PASS / ☐ FAIL |
| Screenshot saved under PHASE4_GO1 | ☐ PASS / ☐ FAIL |

---

*GO1 – Mobile header overflow fix + overflow menu (Settings in menu).*

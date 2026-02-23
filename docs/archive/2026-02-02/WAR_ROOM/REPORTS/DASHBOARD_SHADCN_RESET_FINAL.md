## Dashboard Shadcn Reset — FINAL

Scope: **`/dashboard/site/[siteId]` only** (Ads Command Center)

### Goals
- **Light** look (no dark/glass)
- **shadcn defaults first**: minimal Tailwind overrides
- **No tiny fonts**: minimum readable size is **14px** (`text-sm`) for table rows and metadata
- **No horizontal overflow** (no sideways scroll on mobile)

---

## Typography Rules
- **Default typography**: use shadcn defaults (`text-sm`, `text-base`) and semantic tokens (`text-foreground`, `text-muted-foreground`).
- **Avoid**: `text-[9px]`, `text-[10px]`, `text-xs` in dashboard.
- **Numbers**: use `tabular-nums` for:
  - timestamps
  - counts/KPI numbers
  - IDs/short stamps

---

## Layout Rules (Mobile Header)
Target: header fits in **max 2 rows** on mobile without weird wrapping.

- **Use** `min-w-0` + `truncate` for long site names/domains.
- **Actions** (health, realtime, buttons) should wrap cleanly into the second row.
- **DateRangePicker**: full-width on mobile (container `w-full`), compact on desktop (`sm:w-auto`).

---

## Overflow Rules
- **Page/root**: `overflow-x-hidden`
- **Tables**: only table region gets horizontal scroll:
  - wrap tables in `overflow-x-auto`
  - avoid global `overflow-x-auto` on page containers
- **Long strings**:
  - truncate in-cell (`truncate`, `max-w-*`, `min-w-0`)
  - provide tooltip with full value on hover when truncated (URL, stamps, IDs)

---

## Mobile QA Checklist (must pass)
Test viewports:
- **375px** (iPhone)
- **390px** (iPhone 12/13/14)
- **414px** (iPhone Plus)

Checklist:
- [ ] No sideways scroll (try dragging horizontally)
- [ ] Header fits in max 2 rows; title is truncated, not wrapping weirdly
- [ ] Date range picker is full-width and does not overflow
- [ ] Tables are readable (`text-sm` rows)
- [ ] Table horizontal scroll only inside the table region (if needed)

Desktop QA:
- [ ] 1440px looks clean and aligned
- [ ] No excessive whitespace; cards align nicely

---

## Screenshots to Capture
1) **375px**: `/dashboard/site/[siteId]` header + tabs + date picker (prove no sideways scroll)
2) **375px**: Live Inbox table visible (scroll area only inside table region)
3) **1440px**: full dashboard above the fold (header + KPI row + table)


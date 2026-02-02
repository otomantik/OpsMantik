# Dashboard Forensics (Analyst Report) — Why it “looks wrong” vs shadcn dashboard

**Project:** OpsMantik Ads Command Center  
**Scope:** `/dashboard/site/[siteId]` (Dashboard V2) + styling foundation that impacts it  
**Date:** 2026-01-28  
**Reference UI target:** shadcn dashboard example: [`ui.shadcn.com/examples/dashboard`](https://ui.shadcn.com/examples/dashboard)

---

## 0) Executive summary (1 page)

You’re right: the current dashboard **does not visually match** the shadcn dashboard concept yet.  
The **#1 root cause** is not “colors” or “spacing” — it’s **CSS base sizing**:

> `components/dashboard-v2/reset.css` sets `.om-dashboard-reset { font-size: 14px; }`  
> That changes the **rem base** inside the dashboard. Tailwind (and shadcn) rely heavily on `rem`.  
> Result: **all spacing + typography scale shrink** and proportions feel “off” compared to shadcn.

Secondary causes:
- We replaced some shadcn primitives (Sheet/Tooltip) with lightweight implementations. They work, but **interaction/spacing differs** from the canonical shadcn example.
- We still have **bespoke layout** decisions (custom sidebar, custom headers) that are not using shadcn “blocks” patterns (toolbar, filters row, table density, page header hierarchy).
- The “phone/whatsapp items” expectation is **a product UX mismatch**: the current Queue is a **dense table + qualify panel**; the older “sections/cards” view surfaced those items as primary modules.

If we fix the rem base and standardize the layout hierarchy, the dashboard will “snap” much closer to the shadcn example very quickly.

---

## 1) Timeline (what likely broke “after cleanup”)

From recent commits (local history):

- `952639c` **dashboard shadcn reset** (mobile header, overflow, skeletons)  
- `a54f862` semantic colors + stream cleanup  
- `329f9bf` **purge template css/fonts; shadcn base + tailwind config**  
- `d334714` light-token sweep + WhatsApp Ads 60m inbox  
- `b5c1a78` **Dashboard V2 + CSS isolation**  
- `25b4915` V2 Command Center structure  
- `a56f06f` P0 scoring card  
- `1132440` dense queue table + KPI polish

The user-reported “it was great at noon, then we cleaned old dependencies and it broke” aligns with the **foundation changes** in `globals.css` + `tailwind.config.ts` + font setup, and later the addition of **V2 reset CSS** that changes base sizing.

---

## 2) What shadcn dashboard is doing (visual system)

The shadcn example is consistent because it follows a few strict rules:

1. **Base sizing is untouched** (root rem remains 16px).  
2. **Muted canvas background** + **white cards** (light shadows).  
3. **Page header hierarchy**: Title → description → toolbar row.  
4. **Sidebar navigation** uses consistent spacing and typographic scale.  
5. **Tables are dense and structured**: header row, toolbars, pagination, consistent cell padding.  

Reference: [`ui.shadcn.com/examples/dashboard`](https://ui.shadcn.com/examples/dashboard)

---

## 3) Current dashboard (V2) — symptoms

### 3.1 “It doesn’t look like shadcn”
Observed root symptoms:
- Typography looks “slightly too small / compressed”
- Spacing between elements feels inconsistent
- Cards and tables don’t have the same “breathing room” as shadcn

### 3.2 “Phone/WhatsApp items should be there”
The product expectation is:
- Phone / WhatsApp / Form should feel like **first-class modules**
- The user wants to “see items” immediately (like an inbox)

But current V2 is:
- KPI cards at top
- Queue is a **table** (dense view) + **Qualify side panel**

So there’s a **UX mismatch** between “inbox modules” and “queue table”.

---

## 4) Forensics — root causes (ranked)

### RC-1 (Critical): V2 reset sets `font-size: 14px` → rem scale distortion

File: `components/dashboard-v2/reset.css`

```css
.om-dashboard-reset {
  /* Base font size (14px = text-sm) */
  font-size: 14px;
}
```

**Why this is harmful:**
- Tailwind spacing + type scale uses `rem`.
- When you change the base font-size, `text-sm`, paddings, margins, gaps, etc. no longer match shadcn’s intended proportions.
- This makes everything look “not shadcn” even if you copy the shadcn layout.

**Correct approach for your “min readable font 14px” rule:**
- Keep rem base at 16px, and enforce minimum by:
  - removing `text-xs` usage
  - setting table/meta text to `text-sm`
  - using shadcn defaults (which already use `text-sm` for most UI)

✅ Recommendation: **remove `font-size: 14px` from the reset** (or replace with `font-size: inherit`).

---

### RC-2 (High): Custom “lightweight” UI primitives diverge from shadcn feel

Files:
- `components/ui/tooltip.tsx` (custom tooltip without Radix)
- `components/ui/sheet.tsx` (custom sheet without Radix)

These are functional and acceptable, but shadcn’s example has:
- consistent focus rings
-, precise popover spacing/placement
- keyboard + accessibility behaviors

✅ Recommendation: either:
- embrace these custom primitives but replicate shadcn spacing/focus behavior more closely, or
- go back to canonical shadcn/radix for Tooltip/Sheet when dependencies are stable.

---

### RC-3 (Medium): Reset CSS is overreaching on tables + headings

`reset.css` also enforces:
- table padding/borders
- heading weights/line-height

But you already have shadcn Table and Card components with intended defaults. Double styling can create subtle “off” visuals.

✅ Recommendation: keep reset CSS minimal:
- box-sizing
- overflow-x hidden
- background/text colors
- **do not** redefine table cell padding globally inside the scope

---

### RC-4 (Medium): “Inbox modules” vs “Queue table” product intent mismatch

You want:
1) see Phone/WhatsApp/Form items instantly  
2) qualify them with a forced workflow  

Shadcn dashboard works well when:
- list/table is dense
- and filters are clear

But you also want “modules” for Phone/WhatsApp/Form like an inbox.

✅ Recommendation: combine both:
- Top: **3 mini modules** “Phone”, “WhatsApp”, “Forms” (counts + last intent)
- Middle: **Queue table** (all unscored)
- Right: **Qualify panel**

This keeps the shadcn “dashboard” structure while meeting your “items visible” mental model.

---

### RC-5 (Medium): Data model mismatch caused missing click fields and confusion

You hit:
- `calls.gclid does not exist`

That’s correct because:
- `gclid/wbraid/gbraid` exist on `sessions`
- `calls` carries **`click_id`** for quick attribution

✅ Recommendation:
- In Queue table show `click_id`
- In Session Drawer show the true `sessions.gclid/wbraid/gbraid`
- If you need campaign/keyword later, it belongs to **session attribution** not calls.

---

## 5) What “good” looks like (OpsMantik dashboard spec)

### Layout (shadcn-like)
- **Muted canvas** background
- Left sidebar navigation
- Main content max width + consistent padding
- Cards are not “loud”; tables carry the workflow

### Content hierarchy (Command Center)
1. **KPIs** (Today, Ads-only)  
2. **Quick modules** (Phone / WhatsApp / Forms “new items”)  
3. **Qualification queue table** (dense, 10–15 visible)  
4. **Qualification side panel** (forced workflow)  
5. **Live stream** (secondary, not primary)  

---

## 6) Recovery plan (priority order)

### P0 — Fix the base sizing (fast, huge impact)
- Remove `.om-dashboard-reset { font-size: 14px; }`
- Ensure all small text uses `text-sm` (not `text-xs`)

**Expected impact:** dashboard will instantly feel closer to shadcn due to corrected rem scale.

### P1 — Reduce reset.css scope (stop fighting shadcn)
- Keep only: box-sizing, overflow-x, background/text
- Remove: table padding overrides, heading overrides

### P2 — Add “Phone/WhatsApp/Form modules” above the queue
Add a row of three small cards:
- “Phone (unscored)” count + last timestamp
- “WhatsApp (unscored)” count + last timestamp
- “Forms (unscored)” count + last timestamp (hidden if disabled)

### P3 — Table polish (shadcn pattern)
Add:
- sticky header
- filter row (type filter: Phone/WhatsApp/Form)
- pagination (“Rows per page”)

### P4 — Legacy cleanup (only after V2 is final)
When V2 is stable:
- remove feature flag
- remove V1 components
- delete leftover template CSS artifacts

---

## 7) Concrete acceptance criteria (visual + workflow)

### Visual (shadcn parity)
- Base spacing and typography proportions match shadcn (no “compressed rem” feel)
- Sidebar + main area feels like shadcn example
- Tables show 10–15 rows comfortably

### Workflow (Command Center)
- New intents appear in Queue immediately
- User can qualify in < 10 seconds (open panel, score, seal/junk)
- Session drawer shows device/city/fingerprint + campaign identifiers

---

## 8) Files most implicated

### High impact
- `components/dashboard-v2/reset.css` (**rem base distortion culprit**)
- `app/globals.css` (tokens and base apply)
- `tailwind.config.ts` (container + theme tokens)

### Medium impact
- `components/ui/tooltip.tsx` / `components/ui/sheet.tsx` (custom primitives)
- `components/dashboard-v2/DashboardShell.tsx` (layout structure)
- `components/dashboard-v2/QualificationQueue.tsx` (density + table UI)
- `components/dashboard-v2/KPICardsV2.tsx` (KPI hierarchy)

---

## 9) Notes for “why it looked great earlier”

When the base styling was closer to canonical shadcn (root rem 16px, fewer resets), the UI naturally looked “clean”.  
After “template purge” + added isolation reset, we reintroduced a **new global factor**: **14px base inside the scope**.

That’s why it can feel like: “We cleaned dependencies, then it broke.”  
The dependency cleanup removed template artifacts, but the **isolation reset introduced a new distortion**.

---

## 10) Next action (recommended)

If you want shadcn parity quickest:
1) Remove `font-size:14px` from `.om-dashboard-reset`  
2) Keep min readable font by eliminating `text-xs` across the dashboard  

This one change will unlock the rest of the polish.


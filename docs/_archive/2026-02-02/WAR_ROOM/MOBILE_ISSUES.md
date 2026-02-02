# MOBILE UX ISSUES - Responsive Failures Audit

**Date:** 2026-01-25  
**Purpose:** Mobile viewport (<=390px) and touch device issues

---

## MOBILE ISSUES TABLE

| Screen | Viewport | Symptom | Evidence | Minimal Fix | Risk |
|--------|----------|---------|----------|-------------|------|
| **Dashboard Site Page** | 390px | Fixed Call Monitor (288px) overlaps content, causes horizontal overflow | `app/dashboard/site/[siteId]/page.tsx:80` - `fixed top-6 right-6 z-50 w-72` | Add responsive: `hidden lg:block` or `w-full lg:w-72`, move to bottom sheet on mobile | Low |
| **Dashboard Site Page** | 390px | `pr-80` padding causes horizontal overflow | `app/dashboard/site/[siteId]/page.tsx:84` - `pr-80` | Add responsive: `pr-0 lg:pr-80` | Low |
| **Call Alert Card** | 390px | Action buttons too small (<44px), hard to tap | `components/dashboard/call-alert.tsx:238-256` - `h-7 w-7` buttons | Increase: `h-10 w-10 lg:h-7 lg:w-7` | Low |
| **Call Alert Card** | 390px | Flex layout (`justify-between`) may overflow on small screens | `components/dashboard/call-alert.tsx:191` - `flex justify-between` | Add responsive: `flex-col lg:flex-row` | Low |
| **Live Feed** | 390px | Filter bar not sticky, lost on scroll | `components/dashboard/live-feed.tsx:447-533` - Filter controls in header | Add `sticky top-0 z-10 bg-slate-900` to filter bar container | Low |
| **Live Feed** | 390px | Card header not sticky | `components/dashboard/live-feed.tsx:448` - CardHeader | Make header sticky or move filters outside card | Low |
| **Session Group** | 390px | Context chips wrap badly, layout breaks | `components/dashboard/session-group.tsx:283-304` - Chips in flex wrap | Add `min-w-0` and ensure proper wrapping, consider mobile stack | Low |
| **Session Group** | 390px | Long session ID text may overflow | `components/dashboard/session-group.tsx:186` - Session ID display | Add `truncate` or `break-words` | Low |
| **Stats Cards** | 390px | Grid may squeeze on mobile | `app/dashboard/site/[siteId]/page.tsx:130` - `grid-cols-12` | Add responsive: `grid-cols-1 lg:grid-cols-12` | Low |
| **Tracked Events Panel** | 390px | Scrollable list may have small tap targets | `components/dashboard/tracked-events-panel.tsx:126` - Event items | Increase padding: `p-3` instead of `p-2` | Low |
| **Call Alert Wrapper** | 390px | Fixed position may overlap on mobile | `app/dashboard/site/[siteId]/page.tsx:80` - Fixed positioning | Move to bottom sheet or modal on mobile | Low |
| **Site Switcher** | 390px | Dropdown may overflow viewport | `components/dashboard/site-switcher.tsx` - Select component | Ensure dropdown is viewport-aware | Low |

---

## DETAILED ISSUES

### Issue M1: Fixed Call Monitor Overlap
**Screen:** `/dashboard/site/[siteId]`  
**Viewport:** 390px width  
**Symptom:** Fixed Call Monitor (288px wide) overlaps main content, causes horizontal scroll  
**Evidence:** `app/dashboard/site/[siteId]/page.tsx:80`  
```tsx
<div className="fixed top-6 right-6 z-50 w-72">
  <CallAlertWrapper siteId={siteId} />
</div>
```
**Minimal Fix:**
```tsx
<div className="hidden lg:block fixed top-6 right-6 z-50 w-72">
  <CallAlertWrapper siteId={siteId} />
</div>
// Add mobile version at bottom
<div className="lg:hidden fixed bottom-0 left-0 right-0 z-50 max-h-[50vh] overflow-y-auto">
  <CallAlertWrapper siteId={siteId} />
</div>
```
**Risk:** Low (CSS only)

---

### Issue M2: Small Tap Targets
**Screen:** Call Alert Card  
**Viewport:** 390px width  
**Symptom:** Action buttons (`h-7 w-7` = 28px) below 44px minimum, hard to tap  
**Evidence:** `components/dashboard/call-alert.tsx:238-256`  
**Minimal Fix:**
```tsx
className="h-10 w-10 lg:h-7 lg:w-7 p-0" // 40px on mobile, 28px on desktop
```
**Risk:** Low (CSS only)

---

### Issue M3: Non-Sticky Filter Bar
**Screen:** Live Feed  
**Viewport:** 390px width  
**Symptom:** Filter controls scroll away, users lose filter context  
**Evidence:** `components/dashboard/live-feed.tsx:447-533`  
**Minimal Fix:**
```tsx
<div className="sticky top-0 z-10 bg-slate-900 border-b border-slate-800/50 p-3">
  {/* Filter controls */}
</div>
```
**Risk:** Low (CSS only)

---

### Issue M4: Context Chips Wrapping
**Screen:** Session Group Card  
**Viewport:** 390px width  
**Symptom:** Chips stack vertically, layout breaks, text may overflow  
**Evidence:** `components/dashboard/session-group.tsx:283-304`  
**Minimal Fix:**
```tsx
<div className="flex items-center gap-2 flex-wrap min-w-0">
  {/* Chips with proper min-width */}
  <span className="font-mono text-xs px-2 py-0.5 rounded ... min-w-0 truncate">
```
**Risk:** Low (CSS only)

---

### Issue M5: Horizontal Overflow
**Screen:** Dashboard Site Page  
**Viewport:** 390px width  
**Symptom:** `pr-80` padding causes horizontal scroll  
**Evidence:** `app/dashboard/site/[siteId]/page.tsx:84`  
**Minimal Fix:**
```tsx
<div className="max-w-[1920px] mx-auto pr-0 lg:pr-80">
```
**Risk:** Low (CSS only)

---

### Issue M6: Keyboard Layout Jump
**Screen:** Live Feed (if search added)  
**Viewport:** 390px width  
**Symptom:** Input focus causes layout jump (keyboard opens)  
**Evidence:** N/A (preventive)  
**Minimal Fix:**
```tsx
// Use viewport units or prevent scroll on focus
input:focus { scroll-margin-top: 100px; }
```
**Risk:** Low (CSS only)

---

### Issue M7: Safe Area (iOS)
**Screen:** Fixed Call Monitor (mobile bottom)  
**Viewport:** 390px width (iPhone)  
**Symptom:** Bottom bar overlaps with iOS safe area  
**Evidence:** N/A (preventive)  
**Minimal Fix:**
```tsx
className="pb-safe lg:pb-0" // Tailwind safe area utility
// Or: padding-bottom: env(safe-area-inset-bottom);
```
**Risk:** Low (CSS only)

---

## MOBILE HARDENING PR SCOPE

**PR Title:** `fix: mobile responsive improvements (CSS/layout only)`

**Files:**
- `app/dashboard/site/[siteId]/page.tsx`
- `components/dashboard/call-alert.tsx`
- `components/dashboard/call-alert-wrapper.tsx`
- `components/dashboard/live-feed.tsx`
- `components/dashboard/session-group.tsx`
- `components/dashboard/tracked-events-panel.tsx`

**Changes:**
- Responsive classes (`lg:`, `md:`, `sm:`)
- Increased tap targets (44px+ on mobile)
- Sticky headers/filters
- Proper wrapping (`flex-wrap`, `min-w-0`)
- Safe area support (iOS)

**No Logic Changes:** CSS/layout only

**Acceptance:**
- ✅ Tested on 390px viewport (Chrome DevTools)
- ✅ No horizontal overflow
- ✅ All buttons tappable (44px+)
- ✅ Filter bar sticky
- ✅ No layout breaks

---

**Last Updated:** 2026-01-25

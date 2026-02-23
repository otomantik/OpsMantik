# Phase 3.4 Shared UI i18n Inventory

**Scope:** components/ui/**, shared components, tables, dialogs, empty states, copy-to-clipboard  
**Date:** Phase 3.4

---

## 1. Taxonomy

| Namespace | Purpose | Status |
|-----------|---------|--------|
| common.ui.* | Buttons, tooltips, generic UI labels | Partial (button.copy → common.ui.copy) |
| common.table.* | Table headers, empty states, pagination | Partial (admin.sites.table.*) |
| common.form.* | Form labels, placeholders, validation | Partial (sites.*, session.*) |
| common.emptyState.* | No data / empty list messages | Existing as empty.*, misc.noData |
| toast.* | Toast messages | Exists |

---

## 2. components/ui/* (Primitives)

| File | Notes |
|------|-------|
| dialog.tsx | Headless — no user-facing strings |
| table.tsx | Headless — no user-facing strings |
| button.tsx | Headless — no user-facing strings |
| card.tsx | Headless |
| tooltip.tsx | Headless |
| sheet.tsx | Headless |
| tabs.tsx | Headless |
| dropdown-menu.tsx | Headless |
| textarea.tsx | Headless |
| badge.tsx | Headless |
| separator.tsx | Headless |
| skeleton.tsx | Headless |

**Result:** No changes needed. Content comes from parent components.

---

## 3. Hotspot Inventory

### 3.1 Dialogs
- seal-modal.tsx — uses seal.*, hunter.*
- LazySessionDrawer — uses sessionDrawer.*, session.*

### 3.2 Empty states
- empty.queueMissionAccomplished, empty.noDataYesterday, empty.noDataTodayDesc
- admin.sites.empty, misc.noData, misc.noDataInRange
- **Missing:** common.noResults (search/filter empty)

### 3.3 Copy-to-clipboard
- sites.copied, sites.copy
- session.copySessionId
- **Missing:** session.copyFingerprintTooltip, session.fingerprintShort

### 3.4 Tables
- admin.sites.table.* (name, domain, publicId, etc.)
- session-card-expanded: session.eventCategory, **session.url** (missing)
- session-card-header: **session.viewVisitorHistory** → use session.viewHistory

### 3.5 Pagination
- No dedicated pagination component in shared UI.

---

## 4. Missing Keys (To Add)

| Key | Usage |
|-----|-------|
| common.noResults | sites-table (search filter empty) |
| session.copyFingerprintTooltip | session-card-header title (param: {fingerprint}) |
| session.fingerprintShort | session-card-header label |
| session.url | session-card-expanded table header |
| session.viewVisitorHistory | — (use session.viewHistory) |

---

## 5. Callsite Fixes (Done)

- session-card-header.tsx: `session.viewVisitorHistory` → `session.viewHistory` ✅
- Add above missing keys to en/tr/it

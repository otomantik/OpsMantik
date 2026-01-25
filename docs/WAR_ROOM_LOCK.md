# 🔒 OPS Console Regression Lock

**Purpose**: Prevent critical regressions in OPS Console dashboard  
**Last Updated**: January 24, 2026

---

## 🚫 Non-Negotiables (DO NOT BREAK)

### 1. No `next/font/google` in Client Code
- **Rule**: Never import `next/font/google` in `app/` or `components/` directories
- **Reason**: Adds build-time dependency and can break in sandbox environments
- **Allowed**: Only in `app/layout.tsx` if absolutely necessary (currently not used)

### 2. Partition Month Filter Required
- **Rule**: ALL queries to `sessions` or `events` tables MUST include month partition filter
- **Pattern**: 
  - Sessions: `.eq('created_month', currentMonth)`
  - Events: `.eq('session_month', currentMonth)`
- **Reason**: Monthly partitioning requires partition key in all queries
- **Files to Check**: `components/dashboard/*.tsx`, `app/api/**/*.ts`

### 3. RLS Join Pattern Required
- **Rule**: Client-side queries MUST use JOIN pattern for RLS compliance
- **Pattern**: `sessions!inner(site_id)` or `sites!inner(user_id)`
- **Reason**: Row-Level Security requires JOIN to verify ownership
- **Files to Check**: All `components/dashboard/*.tsx` files

### 4. No Service Role Key in Client
- **Rule**: `SUPABASE_SERVICE_ROLE_KEY` MUST NOT appear in `app/` or `components/` directories
- **Allowed**: Only in `lib/supabase/admin.ts` (server-side only)
- **Reason**: Service role key bypasses RLS - security critical
- **Files to Check**: `app/**/*.tsx`, `components/**/*.tsx`

---

## ✅ Acceptance Checklist

### Source Chips Readability
- [x] SOURCE chip displays attribution source with high contrast
- [x] Label "SOURCE:" in `text-slate-300` (readable on dark bg)
- [x] Value in `text-slate-100 font-semibold` (bright, bold for emphasis)
- [x] Chip uses `bg-slate-700/50` background with `border-slate-600/30` border
- [x] Font family: `font-mono` for consistent monospace display

**Evidence**: `components/dashboard/session-group.tsx` (line 235)

### Context Chips (City/District/Device)
- [x] CITY chip: `text-indigo-300` value, `bg-indigo-500/20` background
- [x] DISTRICT chip: `text-violet-300` value, `bg-violet-500/20` background
- [x] DEVICE chip: `text-amber-300` value, `bg-amber-500/20` background
- [x] Chips only render when values exist and are not "Unknown"
- [x] Chips appear in separate row below SOURCE chip

**Evidence**: `components/dashboard/session-group.tsx` (lines 256, 261, 266)

### GCLID Test Steps
- [x] Test page module: "🎯 Google Ads Test (GCLID)"
- [x] GCLID input field with validation
- [x] "Simulate Paid Click" button sends event with GCLID in metadata
- [x] Dashboard shows `SOURCE: First Click (Paid)` chip
- [x] Dashboard shows GCLID chip when GCLID present

**Evidence**: `app/test-page/page.tsx` (lines 436-525)

### View Session Jump/Highlight
- [x] "View Session" button appears when `matched_session_id` exists
- [x] Button calls `jumpToSession(matched_session_id)`
- [x] Session card scrolls into view with smooth behavior
- [x] Session card highlights with emerald ring + pulse animation
- [x] Highlight removes after 1.5 seconds

**Evidence**: `components/dashboard/call-alert.tsx` (lines 190-200), `lib/utils.ts` (lines 12-29)

---

## 🔍 Evidence Commands (Copy/Paste Ready)

### Check for `next/font/google` Violations
```bash
rg "next/font/google" app/ components/
# Expected: No matches (empty result)
```

### Check for Service Role Key Leakage
```bash
rg "SUPABASE_SERVICE_ROLE_KEY" app/ components/
# Expected: No matches (empty result)
# Allowed: Only in lib/supabase/admin.ts (server-side)
```

### Verify Partition Month Filters
```bash
# Check sessions queries have created_month filter
rg "\.from\('sessions'\)" components/dashboard app/api --type tsx --type ts | rg -v "created_month"
# Expected: No matches (all queries should have created_month)

# Check events queries have session_month filter
rg "\.from\('events'\)" components/dashboard app/api --type tsx --type ts | rg -v "session_month"
# Expected: No matches (all queries should have session_month)
```

### Verify RLS Join Patterns
```bash
# Check client queries use JOIN pattern
rg "\.from\('(sessions|events|calls)'\)" components/dashboard --type tsx | rg -v "!inner"
# Expected: No matches (all queries should use !inner JOIN)
```

### Verify Source Chips Implementation
```bash
rg "SOURCE:" components/dashboard/session-group.tsx
# Expected: Line 235 with text-slate-100 font-semibold styling
```

### Verify Context Chips Implementation
```bash
rg "CITY:|DISTRICT:|DEVICE:" components/dashboard/session-group.tsx
# Expected: Lines 256, 261, 266 with respective color styling
```

### Verify GCLID Test Module
```bash
rg "Google Ads Test \(GCLID\)" app/test-page/page.tsx
# Expected: Line 439 with CardTitle component
```

### Verify View Session Function
```bash
rg "jumpToSession" lib/utils.ts components/dashboard/call-alert.tsx
# Expected: Implementation in both files
```

### TypeScript Check
```bash
npx tsc --noEmit
# Expected: Exit code 0 (no errors)
```

### Build Check
```bash
npm run build
# Expected: Build succeeds (may fail in sandbox due to EPERM, but TS should pass)
```

---

## 🛡️ Automated Checks

### Run Regression Lock Check
```bash
npm run check:warroom
# Expected: Exit code 0 (no violations found)
```

This script checks:
1. No `next/font/google` in `app/` or `components/`
2. No `SUPABASE_SERVICE_ROLE_KEY` in `app/` or `components/`

---

## 📋 Pre-Commit Checklist

Before committing OPS Console changes:

1. [ ] Run `npm run check:warroom` (must pass)
2. [ ] Run `npx tsc --noEmit` (must pass)
3. [ ] Verify partition month filters in new queries
4. [ ] Verify RLS JOIN patterns in new queries
5. [ ] Test "View Session" jump/highlight if Call Monitor changed
6. [ ] Test GCLID flow if test page changed
7. [ ] Verify Source/Context chips still render correctly

---

## 🚨 Breaking Changes Log

### 2026-01-24: Initial Lock
- Established non-negotiables
- Added acceptance checklist
- Created automated check script

---

**Note**: This lock is lightweight and focused on critical regressions. For full feature checklist, see `docs/DEV_CHECKLIST.md`.

**Note**: Script name `check:warroom` is kept for backward compatibility. References in docs use "OPS Console".

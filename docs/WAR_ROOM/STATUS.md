# 🔒 OPS Console Regression Lock

**Purpose**: Prevent critical regressions in OPS Console dashboard  
**Last Updated**: January 27, 2026
**Navigation**: [🚀 Tech Docs INDEX](./INDEX.md)

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

### 5. Multi-Tenant Access Rules (site_members)
- **Rule**: Site access MUST be validated via ownership OR membership OR admin role
- **Pattern**: 
  - Owner: `sites.user_id = auth.uid()`
  - Member: `EXISTS (SELECT 1 FROM site_members WHERE site_id = sites.id AND user_id = auth.uid())`
  - Admin: `profiles.role = 'admin'` (via `isAdmin()` helper)
- **Reason**: Multi-tenant security requires explicit access checks
- **Files to Check**: `app/api/**/*.ts`, `app/dashboard/**/*.tsx`, `app/admin/**/*.tsx`

### 6. Admin Routes Must Guard Access
- **Rule**: Admin-only routes MUST check `isAdmin()` before rendering
- **Pattern**: `const userIsAdmin = await isAdmin(); if (!userIsAdmin) redirect('/dashboard');`
- **Reason**: Admin routes expose sensitive data - must enforce access
- **Files to Check**: `app/admin/**/*.tsx`

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

### Verify Multi-Tenant Implementation
```bash
# Check site_members table usage
rg -n "site_members" app components lib supabase
# Expected: Multiple matches in migrations, API routes, and site-scoped pages

# Check profiles table usage
rg -n "profiles|isAdmin" app lib
# Expected: isAdmin helper and profiles queries found

# Check site-scoped routes
rg -n "/dashboard/site|/admin/sites" app
# Expected: Site-scoped dashboard route and admin sites route found

# Check RLS membership patterns
rg -n "site_members.*user_id.*auth.uid" supabase/migrations
# Expected: RLS policy patterns for site_members found
```

### Verify Admin Access Guards
```bash
# Check admin routes have isAdmin guard
rg -n "isAdmin|redirect.*dashboard" app/admin
# Expected: Admin routes check isAdmin before rendering

# Check site-scoped routes validate access
rg -n "site_members|isAdmin|notFound" app/dashboard/site
# Expected: Access validation found in site-scoped routes
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
5. [ ] Verify multi-tenant access checks (owner OR member OR admin)
6. [ ] Verify admin routes have `isAdmin()` guard
7. [ ] Test "View Session" jump/highlight if Call Monitor changed
8. [ ] Test GCLID flow if test page changed
9. [ ] Verify Source/Context chips still render correctly
10. [ ] Test customer invite flow if membership features changed

---

## 🚨 Breaking Changes Log

### 2026-01-24: Initial Lock
- Established non-negotiables
- Added acceptance checklist
- Created automated check script

### 2026-01-24: Multi-Tenant Support
- Added `profiles` and `site_members` tables
- Updated RLS policies for owner/member/admin access
- Added admin drill-down routes (`/admin/sites`, `/dashboard/site/[siteId]`)
- Added customer invite flow with membership assignment
- Updated access validation patterns

---

**Note**: This lock is lightweight and focused on critical regressions. For full feature checklist, see `docs/_archive/2026-01-27/DEV_CHECKLIST.md`.

**Note**: Script name `check:warroom` is kept for backward compatibility. References in docs use "OPS Console".

### 🟢 Status (2026-01-27)
- [x] **POLISH-2A Done**: Backend stats RPC implemented and verified.
- Commit ID: `6e92fb2f2276e9620de939a81fbab8468e770de4`

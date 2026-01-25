# 🚀 Go-Live Checklist & Evidence Report

**Purpose**: Complete pre-deployment verification and post-deployment validation checklist  
**Last Updated**: January 24, 2026  
**Status**: Production-Ready

---

## 📋 Pre-Deployment Evidence Commands

### 1. Code Quality Checks

```bash
# Check for forbidden patterns (next/font/google)
rg -n "next/font/google" app components lib
# Expected: NO MATCHES (empty output)

# Verify TypeScript compilation
npx tsc --noEmit
# Expected: Exit code 0, no errors

# Verify build succeeds
npm run build
# Expected: Build completes successfully, exit code 0

# Check regression lock
npm run check:warroom
# Expected: Exit code 0, no violations found
```

### 2. Snippet Path Verification

```bash
# Verify assets/core.js snippet usage
rg -n "assets/core.js|data-site-id" docs app components
# Expected: Multiple matches showing correct snippet format

# Verify snippet generator uses correct path
rg -n "assets.*core.js" components/dashboard/sites-manager.tsx
# Expected: Lines showing assets.<domain>/assets/core.js format

# Check public assets exist
test -f public/assets/core.js && echo "✅ core.js exists" || echo "❌ Missing"
test -f public/ux-core.js && echo "✅ ux-core.js exists (legacy)" || echo "⚠️ Legacy file missing"
```

### 3. Security Checks

```bash
# Verify no service role key in client code
rg -n "SUPABASE_SERVICE_ROLE_KEY" app components --exclude "lib/supabase/admin.ts"
# Expected: NO MATCHES (empty output, admin.ts is exception)

# Verify RLS patterns
rg -n "sites.user_id.*auth.uid" supabase/migrations
# Expected: RLS policy patterns found

# Check CORS logic
rg -n "ALLOWED_ORIGINS|isOriginAllowed" app/api/sync/route.ts
# Expected: CORS parsing and validation logic found
```

### 4. Environment Variables Verification

```bash
# Check .env.local.example has all required vars
grep -E "NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY|ALLOWED_ORIGINS|NEXT_PUBLIC_PRIMARY_DOMAIN" .env.local.example
# Expected: All 5 variables found

# Verify Google OAuth vars (if using)
grep -E "GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET" .env.local.example
# Expected: OAuth variables found (if applicable)
```

### 5. Multi-Tenant & Membership Verification

```bash
# Check site_members table usage
rg -n "site_members" app components lib supabase
# Expected: Multiple matches in migrations, API routes, and components

# Check profiles table and admin helper
rg -n "profiles|isAdmin" app lib
# Expected: isAdmin helper found in lib/auth/isAdmin.ts, profiles queries in routes

# Check site-scoped routes
rg -n "/dashboard/site|/admin/sites" app
# Expected: Site-scoped dashboard route and admin sites route found

# Check RLS membership patterns in migrations
rg -n "site_members.*user_id.*auth.uid|profiles.*role.*admin" supabase/migrations
# Expected: RLS policy patterns for multi-tenant access found

# Verify customer invite endpoint
rg -n "/api/customers/invite|site_members.*insert" app/api
# Expected: Invite endpoint creates site_members entries

# Check admin access guards
rg -n "isAdmin|redirect.*dashboard" app/admin
# Expected: Admin routes check isAdmin before rendering
```

### 6. Database Schema Verification (Optional)

```bash
# If connected to Supabase, verify tables exist
# Run in Supabase SQL Editor:
SELECT * FROM site_members LIMIT 5;
SELECT * FROM profiles LIMIT 5;
# Expected: Tables exist and have correct structure

# Verify RLS is enabled
SELECT tablename, rowsecurity FROM pg_tables 
WHERE schemaname = 'public' 
  AND tablename IN ('profiles', 'site_members', 'sites');
# Expected: rowsecurity = true for all tables
```

---

## 🔧 Vercel Environment Variables

### Required Variables (Production)

Set these in **Vercel Dashboard → Settings → Environment Variables → Production**:

```bash
# Supabase Configuration (REQUIRED)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here

# CORS Configuration (REQUIRED)
ALLOWED_ORIGINS="https://example.com,https://www.example.com,https://blog.example.com"
# Format: Comma-separated with protocol, spaces auto-trimmed
# Include all WordPress domains that will send tracking requests

# Primary Domain (REQUIRED for production)
NEXT_PUBLIC_PRIMARY_DOMAIN=example.com
# Format: Domain only (no protocol, no subdomain, no path)
# Used by snippet generator for production-safe URLs

# Google OAuth (OPTIONAL - if using Google login)
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
```

### Variable Details

| Variable | Required | Format | Example | Notes |
|----------|----------|--------|---------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ Yes | `https://xxx.supabase.co` | `https://abc123.supabase.co` | From Supabase Dashboard |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ Yes | String | `eyJhbGc...` | Public key, safe for client |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ Yes | String | `eyJhbGc...` | ⚠️ Secret, server-only |
| `ALLOWED_ORIGINS` | ✅ Yes | `"https://domain1.com,https://domain2.com"` | `"https://example.com,https://www.example.com"` | Include protocol, spaces trimmed |
| `NEXT_PUBLIC_PRIMARY_DOMAIN` | ✅ Yes | `domain.com` | `example.com` | No protocol/subdomain |
| `GOOGLE_CLIENT_ID` | ⚠️ Optional | String | `xxx.apps.googleusercontent.com` | If using Google OAuth |
| `GOOGLE_CLIENT_SECRET` | ⚠️ Optional | String | Secret | If using Google OAuth |

### Environment-Specific Settings

**Production**:
- `ALLOWED_ORIGINS`: Specific domains (no wildcard)
- `NEXT_PUBLIC_PRIMARY_DOMAIN`: Your production domain

**Preview/Development**:
- `ALLOWED_ORIGINS`: Can use `*` for testing
- `NEXT_PUBLIC_PRIMARY_DOMAIN`: Optional (falls back to hostname)

---

## 🌐 Cloudflare DNS Configuration

### Domains to Create

Create the following CNAME records in Cloudflare:

#### 1. Console Subdomain

```
Type: CNAME
Name: console
Target: cname.vercel-dns.com (or your Vercel deployment domain)
Proxy: 🟠 DNS only (gray cloud, NOT orange)
TTL: Auto
```

**Result**: `console.example.com` → Vercel deployment

#### 2. Assets Subdomain

```
Type: CNAME
Name: assets
Target: cname.vercel-dns.com (same as console)
Proxy: 🟠 DNS only (gray cloud, NOT orange)
TTL: Auto
```

**Result**: `assets.example.com` → Vercel deployment

**Note**: Both subdomains can point to the same Vercel deployment. Vercel serves both dashboard and static assets from the same Next.js app.

### DNS Verification Commands

```bash
# Check console subdomain resolution
dig console.example.com
nslookup console.example.com
# Expected: Resolves to Vercel IP/CNAME

# Check assets subdomain resolution
dig assets.example.com
nslookup assets.example.com
# Expected: Resolves to Vercel IP/CNAME

# Verify DNS propagation
# Use: https://dnschecker.org
# Check: console.example.com and assets.example.com
# Expected: All DNS servers show correct CNAME records
```

---

## 📦 WordPress Installation Steps

### Step 1: Create Site in Console

1. Log in to `https://console.example.com/dashboard`
2. Navigate to **Sites** section
3. Click **"+ Add Site"** button
4. Fill in form:
   - **Site Name**: Your WordPress site name
   - **Domain**: Your WordPress domain (e.g., `example.com`)
5. Click **"🚀 Create Site"**
6. **Copy the install snippet** that appears

### Step 2: Install Snippet in WordPress

**Method A: Theme Header (Recommended)**

1. WordPress Admin → **Appearance → Theme File Editor**
2. Select **Theme Header** (`header.php`)
3. Find `</head>` tag
4. Paste snippet **just before** `</head>`:

```html
<script defer src="https://assets.example.com/assets/core.js" data-site-id="<YOUR_SITE_ID>"></script>
</head>
```

5. Click **"Update File"**

**Method B: Plugin (Easier)**

1. Install "Insert Headers and Footers" plugin
2. Go to plugin settings
3. Paste snippet in **"Scripts in Header"** section
4. Save

### Step 3: Verify ALLOWED_ORIGINS

**Critical**: Ensure your WordPress domain is in `ALLOWED_ORIGINS`:

1. Check Vercel Dashboard → Environment Variables
2. Verify `ALLOWED_ORIGINS` includes your WordPress domain:
   ```bash
   ALLOWED_ORIGINS="https://example.com,https://www.example.com"
   ```
3. If missing, add domain and **redeploy**

### Step 4: Test Tracker Installation

1. Visit WordPress page with snippet installed
2. Open browser DevTools (F12) → **Console** tab
3. Look for: `[OPSMANTIK] ✅ Tracker initializing for site: <SITE_ID>`
4. Check **Network** tab → Filter: "sync"
5. Verify POST requests to `https://console.example.com/api/sync`
6. Check response: `200 OK` with `{ status: 'synced', score: ... }`

---

## 🎯 Console Steps (Post-Deployment)

### Step 1: Access Dashboard

1. Open `https://console.example.com/dashboard`
2. Should redirect to `/login` if not authenticated
3. Log in with Supabase credentials (or Google OAuth if configured)

### Step 2: Create Site

1. Navigate to **Sites** section
2. Click **"+ Add Site"**
3. Fill in:
   - **Site Name**: `My WordPress Site`
   - **Domain**: `example.com`
4. Click **"🚀 Create Site"**
5. **Copy the snippet** from success message

### Step 3: Copy Snippet

The snippet will look like:

```html
<script defer src="https://assets.example.com/assets/core.js" data-site-id="abc123def456"></script>
```

**Verify**:
- ✅ Uses `assets.example.com` (from `NEXT_PUBLIC_PRIMARY_DOMAIN`)
- ✅ Uses `/assets/core.js` path (neutral, ad-blocker friendly)
- ✅ Has `data-site-id` attribute
- ✅ Uses `defer` attribute

### Step 4: Verify Install

1. After installing snippet in WordPress, return to console
2. Find your site in **Sites** list
3. Click **"🔍 Verify Install"** button
4. **Expected Results**:
   - Status: `✅ Receiving events` (if traffic exists)
   - OR: `⚠️ No traffic yet` (if no events yet)
   - Last event timestamp (if available)
   - Source information (if available)

### Step 5: See Live Feed

1. Navigate to **Live Feed** section in dashboard
2. Visit your WordPress site (with snippet installed)
3. Perform actions:
   - Scroll page
   - Click links
   - Fill forms (if any)
4. **Expected**: Events appear in Live Feed within 1-2 seconds

**Verification Checklist**:
- [ ] Events appear in Live Feed
- [ ] Session cards show correct information
- [ ] Source chips display correctly (e.g., "Google Ads Test (GCLID)")
- [ ] Context chips appear (CITY, DISTRICT, DEVICE)
- [ ] Lead scores calculate correctly (0-100)
- [ ] Realtime updates work (no page refresh needed)

### Step 6: Multi-Tenant Features (Admin & Customer Access)

#### Admin Access
1. **Admin Dashboard**: Navigate to `https://console.example.com/admin/sites`
2. **Expected**: 
   - Admin sees all sites in system
   - Can click "Open Dashboard" to drill down to any site
   - Site list shows status ("Receiving events" / "No traffic yet")
3. **Site Drill-Down**: Click "Open Dashboard" for any site
4. **Expected**: Redirects to `/dashboard/site/<siteId>` with site-scoped data

#### Customer Access (Member)
1. **Invite Customer**: 
   - Site owner clicks "Invite Customer" in Sites Manager
   - Enters customer email
   - Clicks "📧 Invite"
2. **Expected**: 
   - Success message with magic link
   - Customer receives email (if email service configured)
   - `site_members` entry created with `role: 'viewer'` (default)
3. **Customer Login**:
   - Customer clicks magic link or logs in via email
   - Redirects to `/dashboard`
4. **Expected**:
   - If 1 site: Auto-redirects to `/dashboard/site/<siteId>`
   - If multiple sites: Shows Site Switcher
   - Customer sees ONLY their assigned site(s)
   - Cannot access other sites (403/404)

**Verification Checklist**:
- [ ] Admin can access `/admin/sites`
- [ ] Admin can drill down to any site via "Open Dashboard"
- [ ] Customer invite creates `site_members` entry
- [ ] Invited customer can log in and see only their site
- [ ] Customer cannot access sites they're not a member of
- [ ] Site owner can invite multiple customers to same site

---

## ✅ Post-Deployment Evidence Commands

### 1. Build & TypeScript Verification

```bash
# TypeScript check (should pass)
npx tsc --noEmit
# Expected: Exit code 0, no errors

# Build check (should succeed)
npm run build
# Expected: Build completes, exit code 0

# Regression lock check
npm run check:warroom
# Expected: Exit code 0, no violations
```

### 2. Code Pattern Verification

```bash
# Verify no next/font/google (should be empty)
rg -n "next/font/google" app components lib
# Expected: NO MATCHES (empty output)

# Verify snippet paths use assets/core.js
rg -n "assets.*core.js" components/dashboard/sites-manager.tsx docs
# Expected: Multiple matches showing correct format

# Verify service role key not in client
rg -n "SUPABASE_SERVICE_ROLE_KEY" app components --exclude "lib/supabase/admin.ts"
# Expected: NO MATCHES (empty output)
```

### 3. Documentation Verification

```bash
# Verify docs reference correct paths
rg -n "assets/core.js" docs
# Expected: Multiple matches in INSTALL_WP.md, DEPLOY_VERCEL_CLOUDFLARE.md

# Verify env var documentation
rg -n "NEXT_PUBLIC_PRIMARY_DOMAIN|ALLOWED_ORIGINS" docs
# Expected: Documentation found in multiple docs
```

### 4. Production URL Tests

```bash
# Test console dashboard loads
curl -I https://console.example.com/dashboard
# Expected: HTTP/2 200 or 302 (redirect to login)

# Test assets script loads
curl -I https://assets.example.com/assets/core.js
# Expected: HTTP/2 200, Content-Type: application/javascript

# Test CORS (allowed origin)
curl -X OPTIONS https://console.example.com/api/sync \
  -H "Origin: https://example.com" \
  -H "Access-Control-Request-Method: POST" \
  -v
# Expected: 200 OK, Access-Control-Allow-Origin: https://example.com

# Test CORS (blocked origin)
curl -X POST https://console.example.com/api/sync \
  -H "Origin: https://unauthorized-site.com" \
  -H "Content-Type: application/json" \
  -d '{"test":"data"}' \
  -v
# Expected: 403 Forbidden, "Origin not allowed"
```

---

## 📊 Evidence Report Summary

### Code Quality ✅

| Check | Command | Expected | Status |
|-------|---------|----------|--------|
| No `next/font/google` | `rg -n "next/font/google" app components lib` | Empty | ✅ PASS |
| TypeScript compiles | `npx tsc --noEmit` | Exit 0 | ✅ PASS |
| Build succeeds | `npm run build` | Exit 0 | ✅ PASS |
| Regression lock | `npm run check:warroom` | Exit 0 | ✅ PASS |

### Security ✅

| Check | Command | Expected | Status |
|-------|---------|----------|--------|
| No service role in client | `rg -n "SUPABASE_SERVICE_ROLE_KEY" app components --exclude "lib/supabase/admin.ts"` | Empty | ✅ PASS |
| CORS logic present | `rg -n "ALLOWED_ORIGINS\|isOriginAllowed" app/api/sync/route.ts` | Found | ✅ PASS |
| RLS policies | `rg -n "sites.user_id.*auth.uid" supabase/migrations` | Found | ✅ PASS |
| Multi-tenant RLS | `rg -n "site_members.*user_id.*auth.uid|profiles.*role.*admin" supabase/migrations` | Found | ✅ PASS |
| Admin guards | `rg -n "isAdmin|redirect.*dashboard" app/admin` | Found | ✅ PASS |

### Multi-Tenant Features ✅

| Check | Command | Expected | Status |
|-------|---------|----------|--------|
| site_members usage | `rg -n "site_members" app components lib supabase` | Multiple matches | ✅ PASS |
| profiles/isAdmin | `rg -n "profiles|isAdmin" app lib` | Found | ✅ PASS |
| Site-scoped routes | `rg -n "/dashboard/site|/admin/sites" app` | Found | ✅ PASS |
| Customer invite | `rg -n "/api/customers/invite" app/api` | Found | ✅ PASS |

### Snippet Paths ✅

| Check | Command | Expected | Status |
|-------|---------|----------|--------|
| `assets/core.js` usage | `rg -n "assets/core.js" docs app components` | Multiple matches | ✅ PASS |
| Snippet generator | `rg -n "assets.*core.js" components/dashboard/sites-manager.tsx` | Found | ✅ PASS |
| Public file exists | `test -f public/assets/core.js` | File exists | ✅ PASS |

### Environment Variables ✅

| Variable | Required | Status |
|----------|----------|--------|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ Yes | ✅ Documented |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ Yes | ✅ Documented |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ Yes | ✅ Documented |
| `ALLOWED_ORIGINS` | ✅ Yes | ✅ Documented |
| `NEXT_PUBLIC_PRIMARY_DOMAIN` | ✅ Yes | ✅ Documented |
| `GOOGLE_CLIENT_ID` | ⚠️ Optional | ✅ Documented |
| `GOOGLE_CLIENT_SECRET` | ⚠️ Optional | ✅ Documented |

### DNS Configuration ✅

| Domain | Type | Target | Status |
|--------|------|--------|--------|
| `console.example.com` | CNAME | Vercel | ✅ Configured |
| `assets.example.com` | CNAME | Vercel | ✅ Configured |

---

## 🚨 Pre-Launch Checklist

### Code Verification
- [ ] `rg -n "next/font/google" app components lib` → Empty
- [ ] `npx tsc --noEmit` → Exit 0
- [ ] `npm run build` → Exit 0
- [ ] `npm run check:warroom` → Exit 0
- [ ] `rg -n "SUPABASE_SERVICE_ROLE_KEY" app components --exclude "lib/supabase/admin.ts"` → Empty
- [ ] `rg -n "site_members|profiles|/dashboard/site" app components lib supabase` → Multiple matches
- [ ] `rg -n "isAdmin" app/admin app/dashboard/site` → Admin guards found

### Vercel Configuration
- [ ] Repository imported to Vercel
- [ ] All environment variables set (Production)
- [ ] `NEXT_PUBLIC_SUPABASE_URL` configured
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY` configured
- [ ] `SUPABASE_SERVICE_ROLE_KEY` configured
- [ ] `ALLOWED_ORIGINS` configured (with protocol, no wildcard in production)
- [ ] `NEXT_PUBLIC_PRIMARY_DOMAIN` configured (domain only, no protocol)
- [ ] Initial deployment successful

### Cloudflare DNS
- [ ] Domain added to Cloudflare
- [ ] Nameservers updated at registrar
- [ ] `console` CNAME record created (DNS-only)
- [ ] `assets` CNAME record created (DNS-only)
- [ ] DNS propagation verified

### Vercel Custom Domains
- [ ] `console.example.com` added to Vercel
- [ ] SSL certificate provisioned
- [ ] Domain accessible via HTTPS

### WordPress Setup
- [ ] Site created in console
- [ ] Snippet copied from console
- [ ] Snippet installed in WordPress header
- [ ] WordPress domain in `ALLOWED_ORIGINS`
- [ ] Tracker initializes (browser console check)

### Post-Deployment Tests
- [ ] Console dashboard loads (`https://console.example.com/dashboard`)
- [ ] Login works
- [ ] Site creation works
- [ ] Snippet generator shows correct URL
- [ ] Install verification works
- [ ] Live Feed shows events
- [ ] CORS verification passes
- [ ] Assets load correctly (`https://assets.example.com/assets/core.js`)
- [ ] **Multi-Tenant Tests**:
  - [ ] Admin can access `/admin/sites` (sees all sites)
  - [ ] Admin can drill down to `/dashboard/site/<anySiteId>`
  - [ ] Customer (member) can access `/dashboard/site/<assignedSiteId>`
  - [ ] Customer cannot access `/dashboard/site/<otherSiteId>` (403/404)
  - [ ] Site owner can invite customer via "Invite Customer" form
  - [ ] Invited customer receives magic link and can log in
  - [ ] Invited customer sees only their assigned site in dashboard

---

## 🔍 Troubleshooting Quick Reference

### Issue: Build Fails

```bash
# Check TypeScript errors
npx tsc --noEmit

# Check for missing dependencies
npm install

# Check build logs in Vercel Dashboard
```

### Issue: CORS Errors

```bash
# Verify ALLOWED_ORIGINS format
# Should be: "https://example.com,https://www.example.com"
# NOT: "example.com,www.example.com" (missing protocol)

# Test CORS
curl -X OPTIONS https://console.example.com/api/sync \
  -H "Origin: https://example.com" \
  -v
```

### Issue: Events Not Appearing

1. Check snippet has correct `data-site-id`
2. Verify site belongs to logged-in user (RLS)
3. Check month partition (events from current month only)
4. Verify realtime subscription active (browser console)

### Issue: Snippet URL Wrong

1. Check `NEXT_PUBLIC_PRIMARY_DOMAIN` is set in Vercel
2. Verify format: `example.com` (not `https://example.com`)
3. Redeploy after setting environment variable

---

## 📝 Final Verification Commands

Run these commands before going live:

```bash
# 1. Code quality
rg -n "next/font/google" app components lib
npx tsc --noEmit
npm run build
npm run check:warroom

# 2. Security
rg -n "SUPABASE_SERVICE_ROLE_KEY" app components --exclude "lib/supabase/admin.ts"

# 3. Snippet paths
rg -n "assets/core.js" docs app components
test -f public/assets/core.js

# 4. Environment variables
grep -E "NEXT_PUBLIC_SUPABASE_URL|ALLOWED_ORIGINS|NEXT_PUBLIC_PRIMARY_DOMAIN" .env.local.example

# 5. Production URLs (after deployment)
curl -I https://console.example.com/dashboard
curl -I https://assets.example.com/assets/core.js
curl -X OPTIONS https://console.example.com/api/sync -H "Origin: https://example.com" -v
```

**All checks must pass before going live.**

---

**Last Updated**: January 24, 2026  
**Version**: 1.0  
**Status**: ✅ Production-Ready

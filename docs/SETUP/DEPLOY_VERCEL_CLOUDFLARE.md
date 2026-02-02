# 🚀 Vercel + Cloudflare Deployment Checklist

**Purpose**: Step-by-step guide for deploying OPSMANTIK Console to production  
**Last Updated**: January 24, 2026

---

## 📋 Prerequisites

1. **GitHub Repository**: Private repo with OPSMANTIK code
2. **Vercel Account**: Free tier or higher
3. **Cloudflare Account**: For DNS management (free tier sufficient)
4. **Domain**: Your domain (e.g., `example.com`)
5. **Supabase Project**: Already set up with migrations applied

---

## 🔧 Part 1: Vercel Deployment

### Step 1: Import GitHub Repository

1. Log in to [Vercel Dashboard](https://vercel.com/dashboard)
2. Click **"Add New..."** → **"Project"**
3. Click **"Import Git Repository"**
4. Select your private GitHub repository
5. Authorize Vercel to access your GitHub account if prompted
6. Click **"Import"**

### Step 2: Configure Project Settings

1. **Project Name**: `opsmantik-console` (or your preferred name)
2. **Framework Preset**: Next.js (auto-detected)
3. **Root Directory**: `./` (default)
4. **Build Command**: `npm run build` (default)
5. **Output Directory**: `.next` (default)
6. **Install Command**: `npm install` (default)

**Important**: Do NOT click "Deploy" yet - we need to set environment variables first.

### Step 3: Set Environment Variables

Before deploying, configure all required environment variables:

1. In Vercel project settings, go to **Settings** → **Environment Variables**
2. Add the following variables:

#### Required Variables

```bash
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here

# CORS Configuration
ALLOWED_ORIGINS=example.com,www.example.com,blog.example.com

# Primary Domain (for snippet generator)
NEXT_PUBLIC_PRIMARY_DOMAIN=example.com
```

#### Variable Details

**NEXT_PUBLIC_SUPABASE_URL**:
- Your Supabase project URL
- Format: `https://xxxxxxxxxxxxx.supabase.co`
- Found in: Supabase Dashboard → Project Settings → API

**NEXT_PUBLIC_SUPABASE_ANON_KEY**:
- Supabase anonymous key (public, safe for client)
- Found in: Supabase Dashboard → Project Settings → API → Project API keys

**SUPABASE_SERVICE_ROLE_KEY**:
- Supabase service role key (secret, server-only)
- ⚠️ **Never expose to client**
- Found in: Supabase Dashboard → Project Settings → API → Project API keys
- Keep this secret and never commit to git

**ALLOWED_ORIGINS**:
- Comma-separated list of domains that will send tracking requests
- Format: `domain1.com,www.domain1.com,domain2.com` (no spaces)
- Include all WordPress sites and variations
- Example: `example.com,www.example.com,blog.example.com,shop.example.com`

**NEXT_PUBLIC_PRIMARY_DOMAIN**:
- Your primary production domain (without protocol or subdomain)
- Used by snippet generator to create production-safe tracker URLs
- Format: `example.com` (not `https://example.com` or `www.example.com`)
- If not set, snippet generator falls back to current hostname (development only)
- **Required for production** to ensure correct snippet URLs
- Example: `example.com`

#### Environment-Specific Variables

Vercel allows setting variables per environment:

- **Production**: Set for `Production` environment
- **Preview**: Set for `Preview` environment (optional, can use `*` for dev)
- **Development**: Set for `Development` environment (optional, can use `*` for localhost)

**Recommendation**: 
- Production: Specific domains (e.g., `example.com,www.example.com`)
- Preview/Development: `*` (allows all origins for testing)

### Step 4: Deploy

1. After setting all environment variables, click **"Deploy"**
2. Wait for build to complete (typically 2-5 minutes)
3. Vercel will provide a deployment URL: `https://opsmantik-console-xxxxx.vercel.app`

### Step 5: Verify Initial Deployment

1. Open deployment URL in browser
2. Should redirect to `/login` or show login page
3. Check browser console for errors
4. Verify environment variables are loaded (check Network tab for API calls)

---

## 🌐 Part 2: Cloudflare DNS Configuration

### Step 1: Add Domain to Cloudflare

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Click **"Add a Site"**
3. Enter your domain (e.g., `example.com`)
4. Select plan (Free tier is sufficient for DNS-only)
5. Cloudflare will scan your existing DNS records
6. Review and confirm DNS records

### Step 2: Update Nameservers

1. Cloudflare will provide nameservers (e.g., `ns1.cloudflare.com`)
2. Go to your domain registrar (where you bought the domain)
3. Update nameservers to Cloudflare's nameservers
4. Wait for DNS propagation (can take up to 24 hours, usually 1-2 hours)

### Step 3: Create Console Subdomain (CNAME)

1. In Cloudflare Dashboard, go to **DNS** → **Records**
2. Click **"Add record"**
3. Configure:
   - **Type**: `CNAME`
   - **Name**: `console`
   - **Target**: `cname.vercel-dns.com` (or your Vercel deployment domain)
   - **Proxy status**: 🟠 **DNS only** (gray cloud, not orange)
   - **TTL**: Auto
4. Click **"Save"**

**Why DNS-only?**: 
- Console dashboard doesn't need Cloudflare proxy (Vercel handles SSL/CDN)
- Direct connection to Vercel is faster
- Avoids potential proxy issues with Next.js

### Step 4: Create Assets Subdomain (CNAME)

1. Click **"Add record"** again
2. Configure:
   - **Type**: `CNAME`
   - **Name**: `assets`
   - **Target**: `cname.vercel-dns.com` (same as console)
   - **Proxy status**: 🟠 **DNS only** (gray cloud)
   - **TTL**: Auto
3. Click **"Save"**

**Note**: Both `console` and `assets` can point to the same Vercel deployment. Vercel serves both the dashboard and static assets from the same Next.js app.

### Step 5: Configure Vercel Custom Domain

1. In Vercel Dashboard, go to your project → **Settings** → **Domains**
2. Add domain: `console.example.com`
3. Vercel will provide DNS instructions
4. Verify DNS records match Cloudflare configuration
5. Wait for SSL certificate provisioning (automatic, usually 1-5 minutes)

**Optional**: Add `assets.example.com` domain as well (if you want separate domain for assets)

---

## ✅ Part 3: Post-Deploy Smoke Tests

### Test 1: Console Dashboard Access

```bash
# Open dashboard in browser
https://console.example.com/dashboard

# Expected Results:
# ✅ Page loads without errors
# ✅ Login page appears (if not authenticated)
# ✅ Can log in with Supabase credentials
# ✅ Dashboard loads after login
# ✅ No console errors in browser DevTools
```

**Verification Steps**:
1. Open `https://console.example.com/dashboard`
2. Check browser console (F12) for errors
3. Verify login works
4. Verify dashboard components load (Stats Cards, Live Feed, etc.)

### Test 2: WordPress Snippet Installation

1. Install tracker snippet on a WordPress test page
2. Snippet format:
```html
<script defer src="https://assets.example.com/assets/core.js" data-site-id="<YOUR_SITE_ID>"></script>
```

**Verification Steps**:
1. Visit WordPress page with snippet installed
2. Open browser DevTools → Console
3. Look for: `[OPSMANTIK] ✅ Tracker initializing for site: <SITE_ID>`
4. Check Network tab → Filter: "sync"
5. Verify POST requests to `https://console.example.com/api/sync`
6. Check response: `200 OK` with `{ status: 'synced', score: ... }`

### Test 3: Live Feed Events

1. Log in to dashboard: `https://console.example.com/dashboard`
2. Navigate to **Live Feed** section
3. Visit WordPress page with tracker installed
4. Perform actions:
   - Scroll page
   - Click links
   - Fill forms (if any)
5. **Expected**: Events appear in Live Feed within 1-2 seconds

**Verification Checklist**:
- [ ] Events appear in Live Feed
- [ ] Session cards show correct information
- [ ] Source chips display correctly
- [ ] Context chips (CITY, DISTRICT, DEVICE) appear
- [ ] Lead scores calculate correctly

### Test 4: CORS Verification

```bash
# Test CORS from WordPress domain
curl -X OPTIONS https://console.example.com/api/sync \
  -H "Origin: https://example.com" \
  -H "Access-Control-Request-Method: POST" \
  -v

# Expected Response:
# HTTP/2 200
# access-control-allow-origin: https://example.com
# access-control-allow-methods: POST, OPTIONS
```

**If CORS fails**:
1. Check `ALLOWED_ORIGINS` environment variable in Vercel
2. Verify domain is in comma-separated list (no spaces)
3. Include both `example.com` and `www.example.com` if using both
4. Redeploy after changing environment variables

### Test 5: Assets Loading

```bash
# Test tracker script loads
curl -I https://assets.example.com/assets/core.js

# Expected Response:
# HTTP/2 200
# content-type: application/javascript
```

**Verification**:
1. Script should load without errors
2. Content-Type should be `application/javascript`
3. No CORS errors when loading script

---

## 🔄 Part 4: Rollback & Troubleshooting

### Rollback Deployment

#### Method 1: Vercel Dashboard (Recommended)

1. Go to Vercel Dashboard → Your Project → **Deployments**
2. Find previous working deployment
3. Click **"..."** menu → **"Promote to Production"**
4. Confirm promotion
5. Previous deployment becomes active (usually instant)

#### Method 2: Git Revert

1. Revert problematic commit in GitHub
2. Push to main branch
3. Vercel automatically redeploys
4. Wait for new deployment to complete

### Common Issues & Solutions

#### Issue 1: Environment Variables Not Loading

**Symptoms**:
- API calls fail with 401/403 errors
- Supabase connection errors
- CORS errors even with correct ALLOWED_ORIGINS

**Solution**:
1. Check Vercel Dashboard → Settings → Environment Variables
2. Verify all variables are set for **Production** environment
3. Ensure no typos in variable names (case-sensitive)
4. Redeploy after changing environment variables:
   - Go to Deployments → Latest → **"Redeploy"**
   - Or push a new commit to trigger redeploy

**Debug Command**:
```bash
# Check if env vars are accessible (server-side only)
# Add temporary logging in API route:
console.log('ALLOWED_ORIGINS:', process.env.ALLOWED_ORIGINS);
```

#### Issue 2: CORS Errors After Deployment

**Symptoms**:
- `403 Forbidden` or `Origin not allowed` errors
- Events not reaching API
- Network tab shows CORS preflight failures

**Solution**:
1. Verify `ALLOWED_ORIGINS` includes your WordPress domain
2. Check format: comma-separated, no spaces
3. Include all domain variations:
   - `example.com`
   - `www.example.com`
   - `blog.example.com` (if using subdomains)
4. Redeploy after updating environment variable

**Debug Steps**:
```bash
# Test CORS from command line
curl -X OPTIONS https://console.example.com/api/sync \
  -H "Origin: https://example.com" \
  -H "Access-Control-Request-Method: POST" \
  -v

# Check response headers
# Should include: access-control-allow-origin: https://example.com
```

#### Issue 3: DNS Not Resolving

**Symptoms**:
- `console.example.com` doesn't load
- DNS lookup fails
- SSL certificate errors

**Solution**:
1. Check Cloudflare DNS records:
   - Verify CNAME record exists for `console`
   - Verify target is correct (`cname.vercel-dns.com` or Vercel domain)
   - Check proxy status is DNS-only (gray cloud)
2. Check DNS propagation:
   ```bash
   # Check DNS resolution
   dig console.example.com
   nslookup console.example.com
   ```
3. Wait for DNS propagation (can take up to 24 hours)
4. Verify Vercel custom domain is configured:
   - Vercel Dashboard → Settings → Domains
   - Domain should show "Valid Configuration"

#### Issue 4: Events Not Appearing in Dashboard

**Symptoms**:
- Tracker loads successfully
- API calls return 200 OK
- But no events in dashboard Live Feed

**Solution**:
1. Verify site `public_id` matches `data-site-id` in snippet
2. Check user is logged into correct dashboard account
3. Verify RLS policies (user can see their own sites)
4. Check month partition (events from current month only)
5. Verify realtime subscription is active (check browser console for subscription logs)

**Debug Steps**:
1. Open dashboard → Browser Console
2. Look for: `[LIVE_FEED] ✅ Realtime subscription ACTIVE`
3. Check Network tab for WebSocket connections
4. Verify events are from current month

#### Issue 5: Build Failures

**Symptoms**:
- Deployment fails during build
- TypeScript errors
- Missing dependencies

**Solution**:
1. Check build logs in Vercel Dashboard
2. Verify `package.json` has all dependencies
3. Run local build test:
   ```bash
   npm run build
   ```
4. Fix any TypeScript errors:
   ```bash
   npx tsc --noEmit
   ```
5. Commit and push fixes

### Environment Variable Mismatch Debug

**Checklist**:
1. [ ] All required variables set in Vercel
2. [ ] Variables set for correct environment (Production)
3. [ ] No typos in variable names
4. [ ] Values match Supabase dashboard
5. [ ] `ALLOWED_ORIGINS` format correct (comma-separated, no spaces)
6. [ ] Redeployed after changing environment variables

**Quick Test**:
```bash
# Create test API route to verify env vars (temporary, remove after testing)
# app/api/test-env/route.ts
export async function GET() {
  return Response.json({
    hasSupabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    hasAnonKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    hasServiceRole: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    allowedOrigins: process.env.ALLOWED_ORIGINS,
  });
}

# Test: https://console.example.com/api/test-env
# Expected: All should be true, ALLOWED_ORIGINS should show your domains
```

---

## 📝 Deployment Checklist

### Pre-Deployment
- [ ] GitHub repository is private and accessible
- [ ] All code committed and pushed
- [ ] Supabase project set up with migrations applied
- [ ] Environment variables documented

### Vercel Setup
- [ ] Repository imported to Vercel
- [ ] Project settings configured
- [ ] All environment variables set (Production)
- [ ] Initial deployment successful
- [ ] Deployment URL accessible

### Cloudflare DNS
- [ ] Domain added to Cloudflare
- [ ] Nameservers updated at registrar
- [ ] DNS records created (console CNAME, assets CNAME)
- [ ] Proxy status set to DNS-only (gray cloud)
- [ ] DNS propagation verified

### Vercel Custom Domain
- [ ] `console.example.com` added to Vercel
- [ ] DNS configuration verified
- [ ] SSL certificate provisioned
- [ ] Domain accessible via HTTPS

### Post-Deployment Tests
- [ ] Console dashboard loads (`https://console.example.com/dashboard`)
- [ ] Login works
- [ ] Dashboard components render
- [ ] WordPress snippet installed
- [ ] Tracker initializes (browser console)
- [ ] API calls succeed (Network tab)
- [ ] Events appear in Live Feed
- [ ] CORS verification passes
- [ ] Assets load correctly

---

## 🔒 Security Checklist

- [ ] `SUPABASE_SERVICE_ROLE_KEY` never exposed to client
- [ ] `ALLOWED_ORIGINS` restricted in production (not `*`)
- [ ] All domain variations included in `ALLOWED_ORIGINS`
- [ ] Environment variables not committed to git
- [ ] SSL certificates valid (automatic with Vercel)
- [ ] Private repository (not public)

---

## 📊 Recommended Architecture

```
┌─────────────────────────────────────────────────┐
│              Cloudflare DNS                     │
│  console.example.com → Vercel                  │
│  assets.example.com → Vercel                    │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│              Vercel Deployment                  │
│  Next.js App (Console + Assets)                 │
│  - Dashboard: /dashboard                         │
│  - API: /api/sync, /api/call-event              │
│  - Assets: /assets/core.js                       │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│              Supabase Backend                    │
│  - PostgreSQL (partitioned tables)               │
│  - Realtime subscriptions                        │
│  - Row-Level Security (RLS)                     │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│         WordPress Sites (Clients)               │
│  - Tracker snippet installed                    │
│  - Events sent to /api/sync                     │
└─────────────────────────────────────────────────┘
```

---

## 🚨 Emergency Rollback

If production is broken and you need immediate rollback:

1. **Vercel Dashboard**:
   - Go to Deployments
   - Find last known good deployment
   - Click "Promote to Production"
   - Usually takes < 1 minute

2. **If Vercel is down**:
   - Check Vercel status: https://www.vercel-status.com
   - Wait for service restoration
   - Or use previous deployment URL directly

3. **If DNS is broken**:
   - Temporarily use Vercel deployment URL: `https://opsmantik-console-xxxxx.vercel.app`
   - Update WordPress snippets to use Vercel URL temporarily
   - Fix DNS, then revert snippets

---

## 📞 Support Resources

- **Vercel Docs**: https://vercel.com/docs
- **Cloudflare Docs**: https://developers.cloudflare.com/dns
- **Supabase Docs**: https://supabase.com/docs
- **Project Docs**: `docs/SETUP/INSTALL_WP.md` for WordPress installation

---

**Last Updated**: January 24, 2026  
**Version**: 1.0

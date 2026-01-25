# 📦 WordPress Installation Guide

**Purpose**: Step-by-step guide for installing OPSMANTIK tracker on WordPress sites

---

## 🎯 Prerequisites

1. OPSMANTIK Console account (dashboard access)
2. WordPress site with admin access
3. Access to WordPress theme files or plugin for header injection

---

## 📋 Step-by-Step Installation

### Step 1: Create Site in Console

1. Log in to your OPS Console dashboard
2. Navigate to the **Sites** section
3. Click **"+ Add Site"** button
4. Fill in the form:
   - **Site Name**: Your WordPress site name (e.g., "My Blog")
   - **Domain**: Your WordPress domain (e.g., `example.com` or `www.example.com`)
     - Protocol and path are automatically stripped
     - Enter just the domain: `example.com`
5. Click **"🚀 Create Site"**
6. **Copy the install snippet** that appears after creation

### Step 2: Configure Environment Variables (Server-Side)

**Important**: Before installing the snippet, configure your server's environment variables:

1. **ALLOWED_ORIGINS**: Include your WordPress domain(s)
2. **NEXT_PUBLIC_PRIMARY_DOMAIN**: Set your production domain for snippet generator

#### Environment Variable Format

In your `.env.local` or production environment:

```bash
ALLOWED_ORIGINS="https://site.com,https://www.site.com"
```

**Exact Format Examples**:

**Production (Single Domain)**:
```bash
ALLOWED_ORIGINS="https://example.com,https://www.example.com"
```

**Production (Multiple Sites)**:
```bash
ALLOWED_ORIGINS="https://example.com,https://www.example.com,https://blog.example.com,https://shop.example.com"
```

**Development (Localhost)**:
```bash
ALLOWED_ORIGINS="http://localhost:3000,https://localhost:3000,http://127.0.0.1:3000"
```

**Format Rules**:
- **Comma-separated list** (spaces are automatically trimmed)
- **Include protocol** (`https://` or `http://` for localhost)
- **Include all variations** of your domain:
  - `https://example.com` (naked domain)
  - `https://www.example.com` (www subdomain)
  - `http://localhost:3000` (for local development - both http/https supported)
- **Wildcard `*`** allows all origins (⚠️ **WARNING**: Not recommended for production, will log warning)
- **Spaces are trimmed automatically** - you can include spaces for readability:
  ```bash
  ALLOWED_ORIGINS="https://site.com, https://www.site.com"
  ```

#### Example Configurations

**Development**:
```bash
ALLOWED_ORIGINS=localhost:3000,localhost:3001,127.0.0.1:3000
```

**Production (Single Domain)**:
```bash
ALLOWED_ORIGINS=example.com,www.example.com
```

**Production (Multiple Sites)**:
```bash
ALLOWED_ORIGINS=example.com,www.example.com,blog.example.com,shop.example.com
```

**Note**: If `ALLOWED_ORIGINS` is not set, it defaults to `*` (allows all origins). This works for localhost development but should be restricted in production.

#### NEXT_PUBLIC_PRIMARY_DOMAIN

**Purpose**: Ensures snippet generator outputs correct production URLs.

```bash
NEXT_PUBLIC_PRIMARY_DOMAIN=example.com
```

**Format Rules**:
- Domain only (no protocol, no subdomain, no path)
- Example: `example.com` (not `https://example.com` or `www.example.com`)
- Used in snippet: `https://assets.${NEXT_PUBLIC_PRIMARY_DOMAIN}/assets/core.js`
- If not set, snippet generator shows warning and falls back to current hostname

**Example**:
```bash
# Production
NEXT_PUBLIC_PRIMARY_DOMAIN=example.com

# Resulting snippet:
# <script defer src="https://assets.example.com/assets/core.js" data-site-id="..."></script>
```

### Step 3: Install Snippet in WordPress

#### Method A: Theme Header (Recommended)

1. In WordPress admin, go to **Appearance → Theme File Editor**
2. Select **Theme Header** (`header.php`)
3. Find the `</head>` tag (before closing `</head>`)
4. Paste your install snippet **just before** `</head>`:

```html
<script defer src="https://assets.<YOUR_DOMAIN>/assets/core.js" data-site-id="<YOUR_SITE_ID>"></script>
</head>
```

5. Click **"Update File"**

#### Method B: Functions.php (Alternative)

1. Go to **Appearance → Theme File Editor**
2. Select **Theme Functions** (`functions.php`)
3. Add this code at the end:

```php
function opsmantik_tracker() {
    ?>
    <script defer src="https://assets.<YOUR_DOMAIN>/assets/core.js" data-site-id="<YOUR_SITE_ID>"></script>
    <?php
}
add_action('wp_head', 'opsmantik_tracker');
```

4. Replace `<YOUR_DOMAIN>` and `<YOUR_SITE_ID>` with your actual values
5. Click **"Update File"**

#### Method C: Plugin (Most Flexible)

1. Install a "Header and Footer Scripts" plugin (e.g., "Insert Headers and Footers")
2. Go to plugin settings
3. Paste snippet in **"Scripts in Header"** section
4. Save changes

### Step 4: Verify Installation

1. Visit your WordPress site in a browser
2. Open **Developer Tools** (F12)
3. Go to **Console** tab
4. Look for: `[OPSMANTIK] ✅ Tracker initializing for site: <YOUR_SITE_ID>`
5. Go to **Network** tab
6. Filter by "sync"
7. Look for POST requests to `/api/sync`
8. Check response: Should be `200 OK` with `{ status: 'synced', score: ... }`

---

## 🌐 Recommended Domain Structure

For production deployments, use subdomains for better organization:

### Console Domain
```
console.yourdomain.com
```
- Hosts the OPS Console dashboard
- Example: `https://console.example.com`

### Assets Domain
```
assets.yourdomain.com
```
- Hosts the tracker script (`/assets/core.js`)
- Example: `https://assets.example.com/assets/core.js`
- **CDN-friendly**: Can be served from CDN for better performance

### Environment Variable Example

```bash
# Production domains
ALLOWED_ORIGINS=example.com,www.example.com,blog.example.com,shop.example.com

# Console and assets subdomains (if tracking from console domain)
ALLOWED_ORIGINS=example.com,www.example.com,console.example.com,assets.example.com
```

**Note**: The `assets` subdomain doesn't need to be in `ALLOWED_ORIGINS` unless you're making API calls from that domain. Only the WordPress site domains need to be listed.

---

## ✅ Verification Checklist

### 1. Environment Variable Check

```bash
# Check if ALLOWED_ORIGINS is set (server-side)
echo $ALLOWED_ORIGINS
# Expected: Comma-separated list of domains, or empty (defaults to *)

# In Next.js/Vercel, check environment variables in dashboard
# Expected: ALLOWED_ORIGINS variable exists with your WordPress domains
```

### 2. Snippet Verification

```bash
# Check if snippet is in WordPress header
curl -s https://example.com | grep "assets.*core.js"
# Expected: <script defer src="https://assets.../assets/core.js" data-site-id="..."></script>

# Verify site-id attribute
curl -s https://example.com | grep -o 'data-site-id="[^"]*"'
# Expected: data-site-id="<YOUR_SITE_ID>"
```

### 3. CORS Verification

```bash
# Test CORS from WordPress domain (allowed origin)
curl -X OPTIONS https://console.example.com/api/sync \
  -H "Origin: https://example.com" \
  -H "Access-Control-Request-Method: POST" \
  -v
# Expected: 200 OK with Access-Control-Allow-Origin: https://example.com

# Test CORS with www subdomain (if included in ALLOWED_ORIGINS)
curl -X OPTIONS https://console.example.com/api/sync \
  -H "Origin: https://www.example.com" \
  -H "Access-Control-Request-Method: POST" \
  -v
# Expected: 200 OK with Access-Control-Allow-Origin: https://www.example.com

# Test blocked origin (should be rejected)
curl -X POST https://console.example.com/api/sync \
  -H "Origin: https://unauthorized-site.com" \
  -H "Content-Type: application/json" \
  -d '{"test":"data"}' \
  -v
# Expected: 403 Forbidden with error: "Origin not allowed"

# Test localhost (development)
curl -X OPTIONS http://localhost:3000/api/sync \
  -H "Origin: http://localhost:3000" \
  -H "Access-Control-Request-Method: POST" \
  -v
# Expected: 200 OK (if localhost is in ALLOWED_ORIGINS or wildcard is set)
```

### 4. Tracker Functionality

```bash
# Check browser console for tracker initialization
# Open DevTools → Console
# Expected: [OPSMANTIK] ✅ Tracker initializing for site: <SITE_ID>

# Check network requests
# Open DevTools → Network → Filter: "sync"
# Expected: POST requests to /api/sync with 200 OK responses
```

### 5. Dashboard Verification

1. Log in to OPS Console dashboard
2. Navigate to **Live Feed**
3. Visit your WordPress site
4. Perform actions (scroll, click links)
5. **Expected**: Events appear in dashboard within 1-2 seconds

---

## 🚨 Troubleshooting

### Issue: "Origin not allowed" Error

**Symptoms**: 
- Console shows: `403 Forbidden` or `Origin not allowed`
- Network tab shows CORS errors

**Solution**:
1. Check `ALLOWED_ORIGINS` environment variable includes your WordPress domain
2. Verify domain format (no protocol, no path, just domain)
3. Include both `example.com` and `www.example.com` if using both
4. Restart server after changing environment variables

### Issue: Tracker Not Loading

**Symptoms**:
- No `[OPSMANTIK]` messages in console
- Script tag not found in page source

**Solution**:
1. Verify snippet is in `<head>` section (before `</head>`)
2. Check script URL is correct (assets domain)
3. Verify `data-site-id` attribute is present
4. Check browser console for script loading errors

### Issue: Events Not Appearing in Dashboard

**Symptoms**:
- Tracker initializes but no events in dashboard
- Network requests show 200 OK but dashboard is empty

**Solution**:
1. Verify site `public_id` matches `data-site-id` in snippet
2. Check user is logged into correct dashboard account
3. Verify RLS policies allow user to see site data
4. Check month partition (events from current month only)

---

## 📝 Quick Reference

### Snippet Template

```html
<script defer src="https://assets.<YOUR_DOMAIN>/assets/core.js" data-site-id="<YOUR_SITE_ID>"></script>
```

### Environment Variable Template

**Exact Format** (with protocol):
```bash
ALLOWED_ORIGINS="https://domain1.com,https://www.domain1.com,https://domain2.com"
```

**Development Format**:
```bash
ALLOWED_ORIGINS="http://localhost:3000,https://localhost:3000"
```

**Note**: Spaces are automatically trimmed, so you can format for readability:
```bash
ALLOWED_ORIGINS="https://domain1.com, https://www.domain1.com, https://domain2.com"
```

### Recommended Setup

```
WordPress Site:     https://example.com
Console Dashboard:  https://console.example.com
Assets CDN:         https://assets.example.com
```

---

## 🔒 Security Notes

1. **Never commit `.env.local`** with production `ALLOWED_ORIGINS`
2. **Restrict origins in production** - don't use `*` wildcard (system will warn if detected)
3. **Include all domain variations** - `https://example.com` and `https://www.example.com` are different origins
4. **Include protocol** - Always specify `https://` for production domains
5. **Test CORS before going live** - verify allowed origins work correctly
6. **Wildcard warning** - If `*` is found in production, system logs a warning (but still allows it for backward compatibility)

---

**Last Updated**: January 24, 2026  
**Version**: 1.0

# OPS Console - Tüm URL ve Endpoint Listesi

**Date**: January 24, 2026  
**Purpose**: Complete reference of all URLs, routes, and API endpoints

---

## 📄 Public Pages (Herkes Erişebilir)

### Root & Authentication

| URL | Method | Açıklama | Redirect/Response |
|-----|--------|----------|-------------------|
| `/` | GET | Ana sayfa (root) | → `/dashboard` (auth) veya `/login` (no auth) |
| `/login` | GET | Giriş sayfası | HTML page (Google OAuth button) |
| `/test-page` | GET | Test sayfası (GCLID testi) | HTML page (client component) |

---

## 🔐 Authentication Routes

| URL | Method | Açıklama | Response |
|-----|--------|----------|----------|
| `/auth/callback` | GET | Google OAuth callback handler | `302` → `/dashboard` (success) veya `/login?error=...` |
| `/auth/signout` | POST | Kullanıcı çıkışı | `302` → `/login` |

---

## 📊 Dashboard Pages (Authenticated - Giriş Gerekli)

### Main Dashboard

| URL | Method | Açıklama | Erişim | Response |
|-----|--------|----------|--------|----------|
| `/dashboard` | GET | Ana dashboard (site seçici) | Tüm authenticated kullanıcılar | HTML page |
| `/dashboard/site/[siteId]` | GET | Site-scoped dashboard | Site owner OR member OR admin | HTML page |

**Dashboard Özellikleri:**
- Site Switcher (çoklu site varsa)
- Sites Manager (site oluşturma, snippet, müşteri davet)
- Stats Cards (istatistikler)
- Live Feed (canlı olay akışı)
- Tracked Events Panel (izlenen olaylar)
- Conversion Tracker (dönüşüm takibi)
- Call Alert Wrapper (arama uyarıları)
- Month Boundary Banner (ay sınırı uyarısı)

### Admin Pages

| URL | Method | Açıklama | Erişim | Response |
|-----|--------|----------|--------|----------|
| `/admin/sites` | GET | Tüm siteler listesi (admin) | **Sadece Admin** | HTML page |

**Admin Özellikleri:**
- Tüm siteleri görüntüleme (RLS bypass)
- Site durumu (Receiving events / No traffic)
- Son olay zamanı
- "Open Dashboard" linki ile site detayına gitme
- Arama fonksiyonu

---

## 🔌 API Endpoints

### Site Management API

| Endpoint | Method | Açıklama | Auth | Request Body |
|----------|--------|----------|------|--------------|
| `/api/sites/create` | POST | Yeni site oluştur | ✅ Required | `{ name: string, domain: string }` |
| `/api/sites/[id]/status` | GET | Site durumu (last_event_at) | ✅ Required | - |

**Response Examples:**

`POST /api/sites/create`:
```json
{
  "success": true,
  "site": {
    "id": "uuid",
    "name": "My Site",
    "domain": "example.com",
    "public_id": "abc123..."
  },
  "message": "Site created successfully"
}
```

`GET /api/sites/[id]/status`:
```json
{
  "site_id": "uuid",
  "status": "Receiving events" | "No traffic yet",
  "last_event_at": "2026-01-24T10:30:00Z" | null,
  "last_session_id": "uuid" | null,
  "last_source": "string" | null,
  "last_event_category": "string" | null,
  "last_event_action": "string" | null
}
```

---

### Customer Management API

| Endpoint | Method | Açıklama | Auth | Access Control | Request Body |
|----------|--------|----------|------|----------------|--------------|
| `/api/customers/invite` | POST | Müşteri davet et (site_members) | ✅ Required | Site owner OR admin | `{ email: string, site_id: string, role?: "viewer" | "editor" | "owner" }` |

**Response Example:**

`POST /api/customers/invite`:
```json
{
  "success": true,
  "message": "Customer invited successfully with viewer role.",
  "customer_email": "customer@example.com",
  "site_name": "My Site",
  "login_url": "https://console.example.com/auth/callback?token=...",
  "role": "viewer",
  "note": "Share this login URL with the customer"
}
```

---

### Tracking API (Public - CORS Protected)

| Endpoint | Method | Açıklama | Auth | Rate Limit | CORS |
|----------|--------|----------|------|------------|------|
| `/api/sync` | POST | Tracker event sync (ana tracking endpoint) | ❌ No | 100/min | ✅ ALLOWED_ORIGINS |
| `/api/sync` | OPTIONS | CORS preflight | ❌ No | - | ✅ ALLOWED_ORIGINS |
| `/api/call-event` | POST | Arama olayı kaydet (session match) | ❌ No | 50/min | ✅ ALLOWED_ORIGINS |
| `/api/call-event` | OPTIONS | CORS preflight | ❌ No | - | ✅ ALLOWED_ORIGINS |

**Request Body Examples:**

`POST /api/sync` (compressed format):
```json
{
  "s": "site_id (public_id)",
  "u": "https://example.com/page",
  "sid": "session_id (UUID)",
  "sm": "2026-01-01",
  "ec": "interaction" | "conversion" | "acquisition",
  "ea": "click" | "scroll" | "form_submit",
  "el": "button_name",
  "ev": 100,
  "meta": {
    "fp": "fingerprint_hash",
    "gclid": "EAIaIQobChMI...",
    "duration_sec": 120
  },
  "r": "https://google.com"
}
```

`POST /api/call-event`:
```json
{
  "site_id": "public_id",
  "phone_number": "+905551234567",
  "fingerprint": "fingerprint_hash"
}
```

**Response Examples:**

`POST /api/sync`:
```json
{
  "status": "synced",
  "score": 45
}
```

`POST /api/call-event`:
```json
{
  "status": "matched",
  "call_id": "uuid",
  "session_id": "uuid" | null,
  "lead_score": 75
}
```

---

### Development/Test API

| Endpoint | Method | Açıklama | Auth | Request Body |
|----------|--------|----------|------|--------------|
| `/api/create-test-site` | POST | Test site oluştur (development) | ✅ Required | - |

**Response Example:**

`POST /api/create-test-site`:
```json
{
  "success": true,
  "site": {
    "id": "uuid",
    "public_id": "test_site_abc123",
    "domain": "localhost:3000"
  },
  "message": "Test site created successfully"
}
```

---

## 📋 Complete URL List (Alphabetical)

### Pages
- `/` - Root (redirect)
- `/admin/sites` - Admin sites list
- `/dashboard` - Main dashboard
- `/dashboard/site/[siteId]` - Site-scoped dashboard
- `/login` - Login page
- `/test-page` - Test page

### API Endpoints
- `/api/call-event` - Call event tracking (POST, OPTIONS)
- `/api/create-test-site` - Create test site (POST)
- `/api/customers/invite` - Invite customer (POST)
- `/api/sites/create` - Create site (POST)
- `/api/sites/[id]/status` - Get site status (GET)
- `/api/sync` - Event sync (POST, OPTIONS)

### Auth Routes
- `/auth/callback` - OAuth callback (GET)
- `/auth/signout` - Sign out (POST)

---

## 🔒 Access Control Matrix

| Endpoint/Page | Authentication | Access Control | Notes |
|---------------|----------------|----------------|-------|
| `/` | ❌ | Public | Redirects based on auth status |
| `/login` | ❌ | Public | - |
| `/test-page` | ❌ | Public | - |
| `/auth/callback` | ❌ | Public | OAuth flow |
| `/auth/signout` | ✅ | Authenticated | - |
| `/dashboard` | ✅ | Authenticated | - |
| `/dashboard/site/[siteId]` | ✅ | Owner OR Member OR Admin | RLS + route handler check |
| `/admin/sites` | ✅ | **Admin Only** | `isAdmin()` check |
| `/api/sites/create` | ✅ | Authenticated | - |
| `/api/sites/[id]/status` | ✅ | Owner OR Member OR Admin | RLS + route handler check |
| `/api/customers/invite` | ✅ | Owner OR Admin | Site ownership check |
| `/api/create-test-site` | ✅ | Authenticated | - |
| `/api/sync` | ❌ | CORS (ALLOWED_ORIGINS) | Rate limit: 100/min |
| `/api/call-event` | ❌ | CORS (ALLOWED_ORIGINS) | Rate limit: 50/min |

---

## 🌐 Production URLs (Example)

Assuming `NEXT_PUBLIC_PRIMARY_DOMAIN=opsmantik.com`:

### Dashboard URLs
- `https://console.opsmantik.com/` → Redirect
- `https://console.opsmantik.com/login` → Login
- `https://console.opsmantik.com/dashboard` → Dashboard
- `https://console.opsmantik.com/dashboard/site/[siteId]` → Site dashboard
- `https://console.opsmantik.com/admin/sites` → Admin sites

### API URLs
- `https://console.opsmantik.com/api/sync` → Event sync
- `https://console.opsmantik.com/api/call-event` → Call events
- `https://console.opsmantik.com/api/sites/create` → Create site
- `https://console.opsmantik.com/api/sites/[id]/status` → Site status
- `https://console.opsmantik.com/api/customers/invite` → Invite customer

### Assets URLs
- `https://assets.opsmantik.com/assets/core.js` → Tracker script

### Auth URLs
- `https://console.opsmantik.com/auth/callback` → OAuth callback
- `https://console.opsmantik.com/auth/signout` → Sign out

---

## 📊 Status Code Summary

| Status | Meaning | Common Endpoints |
|--------|---------|------------------|
| `200` | Success | All API endpoints (success) |
| `302` | Redirect | Pages, auth routes |
| `400` | Bad Request | API endpoints (validation) |
| `401` | Unauthorized | Authenticated endpoints |
| `403` | Forbidden | CORS, access control |
| `404` | Not Found | Site not found, page not found |
| `429` | Rate Limit | `/api/sync`, `/api/call-event` |
| `500` | Server Error | All endpoints (errors) |

---

## 🔍 Quick Reference

### Public Endpoints (No Auth)
- `GET /`
- `GET /login`
- `GET /test-page`
- `POST /api/sync` (CORS)
- `POST /api/call-event` (CORS)
- `GET /auth/callback`

### Authenticated Endpoints
- `GET /dashboard`
- `GET /dashboard/site/[siteId]`
- `GET /admin/sites` (admin only)
- `POST /api/sites/create`
- `GET /api/sites/[id]/status`
- `POST /api/customers/invite`
- `POST /api/create-test-site`
- `POST /auth/signout`

### CORS-Protected Endpoints
- `POST /api/sync` (ALLOWED_ORIGINS)
- `OPTIONS /api/sync`
- `POST /api/call-event` (ALLOWED_ORIGINS)
- `OPTIONS /api/call-event`

---

**Last Updated**: January 24, 2026  
**Total Endpoints**: 15 (8 pages, 7 API endpoints)  
**Total Routes**: 17 (including OPTIONS methods)

# OPS Console - API Status Codes & Response Reference

**Date**: January 24, 2026  
**Purpose**: Complete reference of all HTTP status codes and responses for pages and API endpoints

---

## 📄 Public Pages (Server Components)

### `/` (Root)
- **Method**: GET
- **Status Codes**:
  - `302` → Redirect to `/dashboard` (if authenticated)
  - `302` → Redirect to `/login` (if not authenticated)
- **Response**: Redirect (no JSON)

### `/login`
- **Method**: GET
- **Status Codes**:
  - `200` → Login page rendered
  - `302` → Redirect to `/dashboard` (if already logged in)
- **Response**: HTML page

### `/test-page`
- **Method**: GET
- **Status Codes**:
  - `200` → Test page rendered
- **Response**: HTML page (client component)

---

## 🔐 Authentication Routes

### `GET /auth/callback`
- **Purpose**: Google OAuth callback handler
- **Status Codes**:
  - `302` → Redirect to `/dashboard` (success)
  - `302` → Redirect to `/login?error=config` (missing env vars)
  - `302` → Redirect to `/login?error=exchange` (exchange failed)
  - `302` → Redirect to `/login?error=no_session` (session not created)
  - `302` → Redirect to `/login?error=no_code` (no code in URL)
- **Response**: Redirect (no JSON)

### `POST /auth/signout`
- **Purpose**: User sign out
- **Status Codes**:
  - `302` → Redirect to `/login`
- **Response**: Redirect (no JSON)

---

## 📊 Dashboard Pages (Authenticated)

### `GET /dashboard`
- **Purpose**: Main dashboard (site chooser)
- **Status Codes**:
  - `200` → Dashboard rendered
  - `302` → Redirect to `/login` (not authenticated)
  - `302` → Auto-redirect to `/dashboard/site/[siteId]` (if user has exactly 1 site)
- **Response**: HTML page (server component)

### `GET /dashboard/site/[siteId]`
- **Purpose**: Site-scoped dashboard
- **Status Codes**:
  - `200` → Site dashboard rendered
  - `302` → Redirect to `/login` (not authenticated)
  - `404` → Site not found or access denied (notFound())
- **Response**: HTML page (server component)

### `GET /admin/sites`
- **Purpose**: Admin-only sites list
- **Status Codes**:
  - `200` → Admin sites page rendered
  - `302` → Redirect to `/login` (not authenticated)
  - `302` → Redirect to `/dashboard` (not admin)
- **Response**: HTML page (server component)

---

## 🔌 API Endpoints

### `POST /api/sites/create`
- **Purpose**: Create new site
- **Authentication**: Required (cookie-based)
- **Request Body**:
  ```json
  {
    "name": "string (required)",
    "domain": "string (required)"
  }
  ```
- **Status Codes**:
  - `200` → Site created successfully
    ```json
    {
      "success": true,
      "site": { "id": "...", "name": "...", "domain": "...", "public_id": "..." },
      "message": "Site created successfully"
    }
    ```
  - `400` → Missing required fields
    ```json
    { "error": "Name and domain are required" }
    ```
  - `400` → Invalid domain format
    ```json
    { "error": "Invalid domain format" }
    ```
  - `400` → Domain cannot be empty
    ```json
    { "error": "Domain cannot be empty" }
    ```
  - `401` → Unauthorized (not logged in)
    ```json
    { "error": "Unauthorized" }
    ```
  - `500` → Failed to generate unique site ID
    ```json
    { "error": "Failed to generate unique site ID. Please try again." }
    ```
  - `500` → Failed to create site
    ```json
    { "error": "Failed to create site", "details": "..." }
    ```
  - `500` → Internal server error
    ```json
    { "error": "Internal server error", "details": "..." }
    ```

---

### `GET /api/sites/[id]/status`
- **Purpose**: Get site install status (last_event_at, etc.)
- **Authentication**: Required (cookie-based)
- **Access Control**: Site owner OR member OR admin
- **Status Codes**:
  - `200` → Status retrieved successfully
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
  - `400` → Site ID is required
    ```json
    { "error": "Site ID is required" }
    ```
  - `401` → Unauthorized (not logged in)
    ```json
    { "error": "Unauthorized" }
    ```
  - `403` → Site not found or access denied
    ```json
    { "error": "Site not found or access denied" }
    ```
  - `500` → Internal server error
    ```json
    { "error": "Internal server error", "details": "..." }
    ```

---

### `POST /api/customers/invite`
- **Purpose**: Invite customer to site (create membership)
- **Authentication**: Required (cookie-based)
- **Access Control**: Site owner OR admin
- **Request Body**:
  ```json
  {
    "email": "string (required)",
    "site_id": "uuid (required)",
    "role": "viewer" | "editor" | "owner" (optional, default: "viewer")
  }
  ```
- **Status Codes**:
  - `200` → Customer invited successfully
    ```json
    {
      "success": true,
      "message": "Customer invited successfully with viewer role.",
      "customer_email": "customer@example.com",
      "site_name": "My Site",
      "login_url": "https://...",
      "role": "viewer",
      "note": "Share this login URL with the customer"
    }
    ```
  - `200` → Customer already has access (membership updated)
    ```json
    {
      "success": true,
      "message": "Customer already has access. Membership updated to viewer.",
      "customer_email": "customer@example.com",
      "site_name": "My Site",
      "login_url": "https://...",
      "role": "viewer"
    }
    ```
  - `400` → Missing required fields
    ```json
    { "error": "Email and site_id are required" }
    ```
  - `400` → Invalid email format
    ```json
    { "error": "Invalid email format" }
    ```
  - `400` → Invalid role
    ```json
    { "error": "Invalid role. Must be one of: viewer, editor, owner" }
    ```
  - `401` → Unauthorized (not logged in)
    ```json
    { "error": "Unauthorized" }
    ```
  - `403` → Site not found or access denied
    ```json
    { "error": "Site not found or access denied" }
    ```
  - `403` → Not site owner or admin
    ```json
    { "error": "You must be the site owner or an admin to invite customers" }
    ```
  - `500` → Failed to create user
    ```json
    { "error": "Failed to create user", "details": "..." }
    ```
  - `500` → Failed to update membership
    ```json
    { "error": "Failed to update membership", "details": "..." }
    ```
  - `500` → Failed to create membership
    ```json
    { "error": "Failed to create membership", "details": "..." }
    ```
  - `500` → Internal server error
    ```json
    { "error": "Internal server error", "details": "..." }
    ```

---

### `OPTIONS /api/sync`
- **Purpose**: CORS preflight
- **Status Codes**:
  - `200` → CORS headers returned
- **Response Headers**:
  ```
  Access-Control-Allow-Origin: <origin> | *
  Access-Control-Allow-Methods: POST, OPTIONS
  Access-Control-Allow-Headers: Content-Type, Authorization
  Access-Control-Max-Age: 86400
  ```

### `POST /api/sync`
- **Purpose**: Tracker event sync (main tracking endpoint)
- **Authentication**: None (CORS-protected)
- **Rate Limit**: 100 requests/minute per IP
- **Request Body** (compressed format):
  ```json
  {
    "s": "site_id (public_id)",
    "u": "url",
    "sid": "session_id (UUID)",
    "sm": "session_month (YYYY-MM-01)",
    "ec": "event_category",
    "ea": "event_action",
    "el": "event_label",
    "ev": "event_value (number)",
    "meta": { "fp": "fingerprint", "gclid": "...", ... },
    "r": "referrer"
  }
  ```
- **Status Codes**:
  - `200` → Event synced successfully
    ```json
    { "status": "synced", "score": 0-100 }
    ```
  - `200` → Event synced (site not found, but still returns success)
    ```json
    { "status": "synced" }
    ```
  - `400` → Invalid JSON payload
    ```json
    { "status": "error", "message": "Invalid JSON payload" }
    ```
  - `403` → Origin not allowed (CORS)
    ```json
    { "error": "Origin not allowed" }
    ```
  - `429` → Rate limit exceeded
    ```json
    {
      "error": "Rate limit exceeded",
      "retryAfter": 45
    }
    ```
    **Response Headers**:
    ```
    X-RateLimit-Limit: 100
    X-RateLimit-Remaining: 0
    X-RateLimit-Reset: <timestamp>
    Retry-After: <seconds>
    ```
  - `500` → Internal server error
    ```json
    { "status": "error", "message": "Internal server error" }
    ```

---

### `OPTIONS /api/call-event`
- **Purpose**: CORS preflight for call events
- **Status Codes**:
  - `200` → CORS headers returned
- **Response Headers**:
  ```
  Access-Control-Allow-Origin: <origin> | *
  Access-Control-Allow-Methods: POST, OPTIONS
  Access-Control-Allow-Headers: Content-Type
  Access-Control-Max-Age: 86400
  ```

### `POST /api/call-event`
- **Purpose**: Record phone call event (matches with session)
- **Authentication**: None (CORS-protected)
- **Rate Limit**: 50 requests/minute per IP
- **Request Body**:
  ```json
  {
    "site_id": "string (public_id)",
    "phone_number": "string (required)",
    "fingerprint": "string (required)"
  }
  ```
- **Status Codes**:
  - `200` → Call recorded successfully
    ```json
    {
      "status": "matched",
      "call_id": "uuid",
      "session_id": "uuid" | null,
      "lead_score": 0-100
    }
    ```
  - `400` → Missing required fields
    ```json
    { "error": "Missing required fields" }
    ```
  - `403` → Origin not allowed (CORS)
    ```json
    { "error": "Origin not allowed" }
    ```
  - `404` → Site not found
    ```json
    { "error": "Site not found" }
    ```
  - `429` → Rate limit exceeded
    ```json
    {
      "error": "Rate limit exceeded",
      "retryAfter": 30
    }
    ```
    **Response Headers**:
    ```
    X-RateLimit-Limit: 50
    X-RateLimit-Remaining: 0
    X-RateLimit-Reset: <timestamp>
    Retry-After: <seconds>
    ```
  - `500` → Failed to record call
    ```json
    { "error": "Failed to record call" }
    ```
  - `500` → Internal server error
    ```json
    { "error": "Internal server error" }
    ```

---

### `POST /api/create-test-site`
- **Purpose**: Create test site for development
- **Authentication**: Required (cookie-based)
- **Status Codes**:
  - `200` → Test site created successfully
    ```json
    {
      "success": true,
      "site": { "id": "...", "public_id": "...", "domain": "localhost:3000" },
      "message": "Test site created successfully"
    }
    ```
  - `200` → User already has a site
    ```json
    {
      "success": true,
      "site": { ... },
      "message": "You already have a site"
    }
    ```
  - `401` → Unauthorized (not logged in)
    ```json
    { "error": "Unauthorized" }
    ```
  - `500` → Failed to create test site
    ```json
    { "error": "Failed to create test site", "details": "...", "code": "..." }
    ```
  - `500` → Internal server error
    ```json
    { "error": "Internal server error", "details": "..." }
    ```

---

## 📋 Status Code Summary

| Status Code | Meaning | Used In |
|-------------|---------|---------|
| `200` | Success | All API endpoints (success responses) |
| `302` | Redirect | Auth routes, page redirects |
| `400` | Bad Request | Missing/invalid parameters |
| `401` | Unauthorized | Not authenticated |
| `403` | Forbidden | Access denied (CORS, site access) |
| `404` | Not Found | Site not found, page not found |
| `429` | Too Many Requests | Rate limit exceeded |
| `500` | Internal Server Error | Database errors, exceptions |

---

## 🔒 Access Control Summary

### Public Endpoints (No Auth Required)
- `POST /api/sync` (CORS-protected)
- `POST /api/call-event` (CORS-protected)
- `GET /` (redirects)
- `GET /login`
- `GET /test-page`

### Authenticated Endpoints (Cookie-based Auth)
- `POST /api/sites/create` (any authenticated user)
- `GET /api/sites/[id]/status` (site owner OR member OR admin)
- `POST /api/customers/invite` (site owner OR admin)
- `POST /api/create-test-site` (any authenticated user)
- `GET /dashboard` (any authenticated user)
- `GET /dashboard/site/[siteId]` (site owner OR member OR admin)
- `GET /admin/sites` (admin only)

### CORS-Protected Endpoints
- `POST /api/sync` (ALLOWED_ORIGINS env var)
- `POST /api/call-event` (ALLOWED_ORIGINS env var)

---

## 🚨 Error Response Format

All error responses follow this format:
```json
{
  "error": "Error message",
  "details": "Additional details (optional)"
}
```

Some endpoints include additional fields:
- `code`: Error code (e.g., PostgreSQL error codes)
- `retryAfter`: Seconds to wait before retry (rate limit)

---

**Last Updated**: January 24, 2026  
**Version**: 1.0

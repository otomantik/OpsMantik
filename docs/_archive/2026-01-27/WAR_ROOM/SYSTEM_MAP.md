# SYSTEM MAP - OpsMantik Route & Screen Inventory

**Date:** 2026-01-25  
**Purpose:** Complete route and screen mapping for audit

---

## ROUTES & PAGES (App Router)

### Public Routes
- **`/`** (app/page.tsx)
  - **Outcome:** Redirects authenticated users to `/dashboard`, unauthenticated to `/login`
  - **Data:** None (server-side auth check)

- **`/login`** (app/login/page.tsx)
  - **Outcome:** OAuth sign-in page (Google)
  - **Data:** None (client-side auth check)

### Auth Routes
- **`/auth/callback`** (app/auth/callback/route.ts)
  - **Outcome:** OAuth callback handler, redirects to `/dashboard`
  - **Data:** OAuth tokens stored in Supabase

- **`/auth/signout`** (app/auth/signout/route.ts)
  - **Outcome:** Signs out user, redirects to `/login`
  - **Data:** Clears auth session

### Dashboard Routes
- **`/dashboard`** (app/dashboard/page.tsx)
  - **Outcome:** Router page (0/1/many sites logic)
    - 0 sites: Shows SitesManager + SiteSetup (dev only)
    - 1 site: Redirects to `/dashboard/site/<id>`
    - Many sites: Shows SiteSwitcher + SitesManager
  - **Data:** Sites list (RLS-protected)

- **`/dashboard/site/[siteId]`** (app/dashboard/site/[siteId]/page.tsx)
  - **Outcome:** Primary working dashboard (site-scoped)
  - **Components:**
    - StatsCards (siteId)
    - LiveFeed (siteId)
    - TrackedEventsPanel (siteId)
    - CallAlertWrapper (siteId) - Fixed top-right
    - ConversionTracker (siteId)
    - MonthBoundaryBanner
  - **Data:** Site verification (RLS), all components filter by siteId

### Admin Routes
- **`/admin/sites`** (app/admin/sites/page.tsx)
  - **Outcome:** Admin-only site management
  - **Data:** RPC `admin_sites_list` (single query, no N+1)
  - **Guard:** Redirects non-admins to `/dashboard`

### Test Routes
- **`/test-page`** (app/test-page/page.tsx)
  - **Outcome:** Event tracker testing page (dev only)
  - **Features:** 4 attribution scenarios, event triggers, session info

---

## API ENDPOINTS

### Tracking
- **`POST /api/sync`** (app/api/sync/route.ts)
  - **Purpose:** Event ingestion endpoint
  - **Data:** Creates sessions, events, call intents
  - **Logic:** Attribution computation, lead scoring, geo extraction

- **`POST /api/call-event`** (app/api/call-event/route.ts)
  - **Purpose:** Phone call matching endpoint
  - **Data:** Creates calls with matched_session_id

### Site Management
- **`POST /api/sites/create`** (app/api/sites/create/route.ts)
  - **Purpose:** Create new site
  - **Data:** Inserts into sites table

- **`GET /api/sites/[id]/status`** (app/api/sites/[id]/status/route.ts)
  - **Purpose:** Get site status (RECEIVING/NO_TRAFFIC)
  - **Logic:** 10-minute window check

- **`POST /api/create-test-site`** (app/api/create-test-site/route.ts)
  - **Purpose:** Create test site (dev only)

### Customer Management
- **`POST /api/customers/invite`** (app/api/customers/invite/route.ts)
  - **Purpose:** Invite customer to site

---

## CIQ SCREENS (Call Intent Queue)

### Call Monitor
- **Component:** `CallAlertWrapper` (components/dashboard/call-alert-wrapper.tsx)
  - **Location:** Fixed top-right on `/dashboard/site/[siteId]`
  - **Data Source:** `calls` table (RLS-protected)
  - **Filter:** `status IN ('intent', 'confirmed', 'qualified', 'real', null)`
  - **Sort:** `created_at DESC`
  - **Limit:** 20 calls
  - **Realtime:** Subscribes to `calls` INSERT events

### Call Alert Card
- **Component:** `CallAlertComponent` (components/dashboard/call-alert.tsx)
  - **Badges:** INTENT (amber), CONFIRMED (blue), MATCH (green)
  - **Actions:** Confirm, Junk, View Session, Dismiss
  - **State:** Local state for status updates

---

## LIVE FEED SCREENS

### Live Event Feed
- **Component:** `LiveFeed` (components/dashboard/live-feed.tsx)
  - **Location:** Main column on `/dashboard/site/[siteId]`
  - **Data Source:** `events` table (JOIN sessions for RLS)
  - **Filter:** Current month partition, siteId (if provided)
  - **Sort:** `created_at DESC` (no tie-breaker)
  - **Limit:** 100 events, 10 sessions displayed
  - **Realtime:** Subscribes to `events` INSERT events
  - **Grouping:** Events grouped by session_id

### Session Cards
- **Component:** `SessionGroup` (components/dashboard/session-group.tsx)
  - **Data:** Fetches session data (attribution_source, device_type, city, district)
  - **Fallback:** Uses event metadata if session fields missing
  - **Context Chips:** Always visible (city, district, device)

---

## COMPONENT REGISTRY

### Dashboard Components
1. **StatsCards** - Session/event counts, avg lead score
2. **LiveFeed** - Real-time event stream with filters
3. **CallAlertWrapper** - Call monitor container
4. **CallAlertComponent** - Individual call card
5. **TrackedEventsPanel** - Event type statistics
6. **ConversionTracker** - Conversion metrics
7. **SessionGroup** - Session card with events
8. **SitesManager** - Site list/creation
9. **SiteSwitcher** - Multi-site selector
10. **SiteSetup** - Test site creation (dev only)
11. **MonthBoundaryBanner** - Month transition warning

### UI Components
- **Button** (shadcn/ui)
- **Card** (shadcn/ui)

---

## DATA FETCHING PATTERNS

### Server Components
- Use `createClient()` from `@/lib/supabase/server`
- RLS enforced automatically
- Examples: `/dashboard`, `/dashboard/site/[siteId]`, `/admin/sites`

### Client Components
- Use `createClient()` from `@/lib/supabase/client`
- RLS enforced via JOIN patterns
- Examples: All dashboard components

### RPC Functions
- `admin_sites_list` - Admin sites with status (single query)

---

**Last Updated:** 2026-01-25

# OPSMANTIK - Deep System Architecture Report

## Executive Summary

OPSMANTIK is a real-time attribution and lead intelligence platform designed for high-scale event tracking, multi-touch attribution, and phone call matching. The system processes millions of events per month using PostgreSQL monthly partitioning, Supabase Realtime subscriptions, and intelligent lead scoring algorithms.

---

## 1. Database Architecture

### 1.1 Core Tables

#### `sites` (Multi-Tenant Foundation)
- **Purpose**: Multi-tenant site ownership and configuration
- **Key Fields**:
  - `id` (UUID, Primary Key)
  - `user_id` (UUID, Foreign Key → `auth.users(id)`)
  - `public_id` (TEXT, UNIQUE) - External identifier used in tracker script
  - `domain` (TEXT) - Site domain for validation
  - `name` (TEXT, Optional) - Human-readable site name
- **Indexes**: `idx_sites_user_id`, `idx_sites_public_id`
- **RLS**: Enabled - Users can only access their own sites
- **Relationships**: One-to-many with `sessions`, `calls`

#### `sessions` (Partitioned by Month)
- **Purpose**: User session tracking with monthly partitioning for scalability
- **Partition Strategy**: Range partitioning by `created_month` (e.g., `sessions_2026_01`)
- **Key Fields**:
  - `id` (UUID, Primary Key) - Client-generated UUID v4
  - `site_id` (UUID, Foreign Key → `sites(id)`)
  - `created_month` (DATE, NOT NULL) - Partition key
  - `ip_address` (INET) - User IP for geo-location
  - `entry_page` (TEXT) - First page visited
  - `exit_page` (TEXT) - Last page visited
  - `gclid` (TEXT) - Google Click ID for attribution
  - `wbraid`, `gbraid` (TEXT) - Additional Google Ads identifiers
  - `total_duration_sec` (INTEGER) - Session duration
  - `event_count` (INTEGER) - Total events in session
- **Composite Primary Key**: `(id, created_month)` - Required for partitioned tables
- **Indexes**: `idx_sessions_site_id`, `idx_sessions_created_month`
- **RLS**: Enabled - Users access sessions through site ownership
- **Partition Creation**: Automatic via migration DO block for current month

#### `events` (Partitioned by Month)
- **Purpose**: Granular event tracking with JSONB metadata storage
- **Partition Strategy**: Range partitioning by `session_month` (e.g., `events_2026_01`)
- **Key Fields**:
  - `id` (UUID, Primary Key, Auto-generated)
  - `session_id` (UUID, NOT NULL) - Links to session
  - `session_month` (DATE, NOT NULL) - Partition key, must match session's `created_month`
  - `url` (TEXT, NOT NULL) - Page URL where event occurred
  - `event_category` (TEXT, NOT NULL) - Category: `acquisition`, `interaction`, `conversion`, `system`
  - `event_action` (TEXT, NOT NULL) - Specific action: `view`, `click`, `scroll_depth`, `phone_call`, etc.
  - `event_label` (TEXT, Optional) - Additional context
  - `event_value` (NUMERIC, Optional) - Quantitative value (scroll depth %, video watch time, etc.)
  - `metadata` (JSONB, Default: `{}`) - Flexible storage for:
    - `fingerprint` (TEXT) - Browser fingerprint for device identification
    - `gclid` (TEXT) - Google Click ID persistence
    - `lead_score` (INTEGER) - Calculated lead score (0-100)
    - `attribution_source` (TEXT) - Attribution model result
    - `intelligence_summary` (TEXT) - Human-readable summary
    - `device_info` (JSONB) - User agent, screen size, timezone
    - `geo_info` (JSONB) - Location data (currently defaults to 'Unknown')
- **Composite Foreign Key**: `(session_id, session_month)` → `sessions(id, created_month)`
- **Indexes**: 
  - `idx_events_session_id` - Fast session lookup
  - `idx_events_session_month` - Partition filtering
  - `idx_events_category` - Category-based queries
  - `idx_events_created_at` - Time-based sorting
- **RLS**: Enabled - Users access events through session → site ownership (JOIN pattern required)
- **Partition Creation**: Automatic via migration DO block

#### `calls` (Phone Call Matching)
- **Purpose**: Phone call tracking and session matching via fingerprint
- **Key Fields**:
  - `id` (UUID, Primary Key, Auto-generated)
  - `site_id` (UUID, Foreign Key → `sites(id)`)
  - `phone_number` (TEXT, NOT NULL) - Called phone number
  - `matched_session_id` (UUID, Optional) - Linked session if match found
  - `matched_fingerprint` (TEXT, Optional) - Browser fingerprint used for matching
  - `lead_score` (INTEGER, Default: 0) - Lead score at time of call
  - `status` (TEXT, Optional) - Quick action status: `qualified`, `junk`, or `NULL`
  - `created_at` (TIMESTAMPTZ) - Call timestamp
- **Indexes**: 
  - `idx_calls_site_id` - Site filtering
  - `idx_calls_matched_session` - Session lookup
  - `idx_calls_status` - Status filtering (where status IS NOT NULL)
- **RLS**: Enabled - Users access calls through site ownership
- **Matching Logic**: 30-minute time window, fingerprint-based matching via `/api/call-event`

#### `user_credentials` (OAuth Storage)
- **Purpose**: Secure storage of OAuth tokens for Google Ads API integration
- **Key Fields**:
  - `id` (UUID, Primary Key)
  - `user_id` (UUID, Foreign Key → `auth.users(id)`)
  - `provider` (TEXT, NOT NULL) - OAuth provider (e.g., 'google')
  - `access_token` (TEXT) - OAuth access token
  - `refresh_token` (TEXT) - OAuth refresh token
  - `expires_at` (TIMESTAMPTZ) - Token expiration
- **Unique Constraint**: `(user_id, provider)` - One credential set per provider per user
- **RLS**: Enabled - Users can only manage their own credentials
- **Security Note**: Encryption recommended for production

### 1.2 Partitioning Strategy

**Monthly Range Partitioning**:
- **Sessions**: Partitioned by `created_month` (DATE)
- **Events**: Partitioned by `session_month` (DATE, must match session's `created_month`)
- **Partition Naming**: `{table}_{YYYY_MM}` (e.g., `sessions_2026_01`, `events_2026_01`)
- **Automatic Creation**: Migration DO block creates partitions for current month
- **Benefits**:
  - Query performance: Only scan relevant month partitions
  - Maintenance: Easy to archive/drop old partitions
  - Scalability: Handles millions of events per month
- **Critical Constraint**: ALL inserts MUST include partition key (`created_month` or `session_month`)

### 1.3 Row Level Security (RLS)

**RLS Policies**:
1. **Sites**: Users can SELECT/INSERT/UPDATE only their own sites (`auth.uid() = user_id`)
2. **Sessions**: Users can SELECT sessions where `sites.user_id = auth.uid()` (JOIN pattern)
3. **Events**: Users can SELECT events where `sites.user_id = auth.uid()` via `sessions` JOIN
4. **Calls**: Users can SELECT calls where `sites.user_id = auth.uid()` (JOIN pattern)
5. **User Credentials**: Users can manage only their own credentials

**Query Pattern Requirement**:
- Direct queries to `events` or `calls` will fail RLS
- Must use JOIN pattern: `events.select('*, sessions!inner(site_id)')`
- This ensures RLS can verify site ownership through the relationship chain

---

## 2. Event Tracking System

### 2.1 Event Categories

#### `acquisition` (Traffic Source Events)
- **Purpose**: Track how users arrive at the site
- **Common Actions**:
  - `session_start` - New session initiated
  - `view` - Page view (first event in session)
  - `heartbeat` - Session keepalive (every 30 seconds)
  - `session_end` - Session termination
- **Metadata**: GCLID, referrer, attribution source

#### `interaction` (User Engagement Events)
- **Purpose**: Track user engagement and intent signals
- **Common Actions**:
  - `page_view` - Page navigation
  - `scroll_depth` - Scroll percentage (50%, 90%)
  - `hover_intent` - 2+ second hover on interactive elements
  - `video_watch` - Video playback (duration in seconds)
  - `external_link` - Outbound link clicks
  - `download` - File downloads
- **Value Field**: Used for quantitative data (scroll %, video duration, etc.)

#### `conversion` (Goal Completion Events)
- **Purpose**: Track conversion actions and high-intent behaviors
- **Common Actions**:
  - `form_submit` - Form submissions
  - `phone_call` - Phone link clicks (`tel:` links)
  - `whatsapp` - WhatsApp link clicks
  - `cta_click` - Call-to-action button clicks
  - `newsletter_signup` - Newsletter subscriptions
  - `download` - Important file downloads (brochures, PDFs)
- **Lead Score Impact**: +50 points per conversion event

#### `system` (Infrastructure Events)
- **Purpose**: System-level tracking and session management
- **Common Actions**:
  - `heartbeat` - Session keepalive (30-second intervals)
  - `session_end` - Session termination
- **Metadata**: Session duration, exit page, exit intent

### 2.2 Event Flow

1. **Client-Side Tracking** (`public/assets/core.js` - neutral path, legacy: `ux-core.js`):
   - Tracker script injected via `<script data-site-id="...">`
   - Generates UUID v4 session ID (RFC 4122 compliant)
   - Creates browser fingerprint (canvas + user agent + screen + timezone)
   - Extracts GCLID from URL parameters
   - Sends compressed payload to `/api/sync`

2. **API Processing** (`app/api/sync/route.ts`):
   - Validates site ownership via `public_id`
   - Validates/creates session in correct partition
   - Calculates lead score based on event type and context
   - Determines attribution source (First Click, Return Visitor, Organic)
   - Stores event with metadata in correct partition
   - Returns lead score to client

3. **Real-Time Propagation**:
   - Supabase Realtime subscription on `events` table
   - Dashboard components receive INSERT events
   - Live Feed updates automatically
   - Call Monitor triggers on phone call matches

### 2.3 Event Payload Structure

**Compressed Format** (sent to `/api/sync`):
```json
{
  "s": "test_site_123",           // site_id (public_id)
  "u": "https://example.com/page", // url
  "sid": "uuid-v4-session-id",    // session_id
  "sm": "2026-01-01",             // session_month (YYYY-MM-DD)
  "ec": "conversion",              // event_category
  "ea": "phone_call",              // event_action
  "el": "tel:+905551234567",       // event_label (optional)
  "ev": 30,                        // event_value (optional, numeric)
  "r": "https://google.com",       // referrer
  "meta": {                        // metadata (JSONB)
    "fp": "browser-fingerprint",
    "gclid": "GCLID_VALUE",
    "device_info": {...},
    "geo_info": {...}
  }
}
```

---

## 3. Lead Scoring Algorithm

### 3.1 Scoring Rules

**Base Scoring**:
- `conversion` category: +50 points
- `interaction` category: +10 points

**Engagement Scoring**:
- `scroll_depth` ≥ 50%: +10 points
- `scroll_depth` ≥ 90%: +20 points
- `hover_intent`: +15 points

**Context Scoring**:
- Google referrer: +5 points
- Returning ad user (fingerprint match with past GCLID): +25 points

**Maximum Score**: 100 (capped)

### 3.2 Intelligence Summary

- **0-30**: "Standard Traffic"
- **31-60**: "Standard Traffic" (with blue border in UI)
- **61-80**: "🔥 Hot Lead" (with orange pulsing border)
- **81-100**: "💎 Premium Opportunity" (with orange pulsing border)

### 3.3 Score Persistence

- Lead score calculated per event
- Stored in `events.metadata.lead_score`
- Session-level score = highest event score in session
- Used for call matching prioritization

---

## 4. Multi-Touch Attribution

### 4.1 Attribution Models

#### First Click (Paid)
- **Trigger**: GCLID present in current URL
- **Attribution**: "First Click (Paid)"
- **Lead Score Bonus**: +5 (Google referrer) + potential +25 (returning user)

#### Return Visitor (Ads Assisted)
- **Trigger**: No GCLID in URL, but fingerprint matches past session with GCLID
- **Attribution**: "Return Visitor (Ads Assisted)"
- **Lead Score Bonus**: +25 points
- **Logic**: Query past events by fingerprint, check for GCLID in metadata

#### Organic
- **Trigger**: No GCLID, no fingerprint match with past GCLID
- **Attribution**: "Organic"
- **Lead Score Bonus**: None

### 4.2 GCLID Persistence

- **Storage**: 
  - Session-level: `sessions.gclid`
  - Event-level: `events.metadata.gclid`
  - Client-side: `sessionStorage.getItem('opmantik_session_context')`
- **Persistence**: GCLID persists across sessions via fingerprint matching
- **Use Case**: Track users who clicked ad, left, then returned organically

---

## 5. Phone Call Matching

### 5.1 Matching Algorithm

**Endpoint**: `/api/call-event` (POST)

**Input**:
```json
{
  "site_id": "site-uuid",
  "phone_number": "+905551234567",
  "fingerprint": "browser-fingerprint-hash"
}
```

**Process**:
1. Validate site ownership
2. Find sessions with matching fingerprint in last 30 minutes
3. Select session with highest lead score
4. Create `calls` record with `matched_session_id` and `matched_fingerprint`
5. Return match result with lead score

**Time Window**: 30 minutes from call to session events

**Priority**: Highest lead score session wins if multiple matches

### 5.2 Call Status Management

- **Status Values**: `qualified`, `junk`, or `NULL`
- **Quick Actions**: Dashboard provides buttons to mark calls as qualified/junk
- **Use Case**: Sales team can quickly categorize leads

---

## 6. Real-Time Architecture

### 6.1 Supabase Realtime

**Publication**: `supabase_realtime` (global, all tables)
**REPLICA IDENTITY**: `FULL` (required for partitioned tables)

**Subscriptions**:
1. **Events Stream**: `postgres_changes` on `events` table (INSERT events)
   - Filtered by `session_month` to current month partition
   - Verified via JOIN pattern for RLS compliance
2. **Calls Stream**: `postgres_changes` on `calls` table (INSERT events)
   - No partition filter (calls table not partitioned)
   - Verified via JOIN pattern for RLS compliance

**Client Implementation**:
- React `useEffect` hooks manage subscriptions
- Cleanup on unmount to prevent memory leaks
- Dependency guards ensure subscriptions only start after site data loaded

### 6.2 Live Feed Component

**Features**:
- Real-time event display (last 100 events)
- Session grouping (events grouped by `session_id`)
- Lead score visualization (color-coded borders)
- Hover insights (mini-map of user journey)
- Phone call match indicators

**Performance**:
- Limits to 100 most recent events
- Groups events client-side for display
- Debounced updates to prevent UI thrashing

---

## 7. API Endpoints

### 7.1 `/api/sync` (POST)

**Purpose**: Primary event tracking endpoint

**Rate Limiting**: 100 requests per minute per IP

**CORS**: Configurable via `ALLOWED_ORIGINS` environment variable

**Request Flow**:
1. CORS validation
2. Rate limit check
3. JSON payload parsing
4. Site validation (public_id → internal UUID)
5. Session lookup/creation (UUID v4 validation, partition-aware)
6. Lead score calculation
7. Attribution determination
8. Event insertion (with partition key)
9. Response with lead score

**Error Handling**:
- Comprehensive try-catch blocks
- Detailed logging for debugging
- Proper HTTP status codes (200, 400, 403, 429, 500)
- CORS headers on all responses

**Response**:
```json
{
  "status": "synced",
  "score": 75
}
```

### 7.2 `/api/call-event` (POST)

**Purpose**: Phone call matching endpoint

**Rate Limiting**: 50 requests per minute per IP

**Request Flow**:
1. CORS validation
2. Rate limit check
3. Site validation
4. Fingerprint-based session matching (30-minute window)
5. Call record creation
6. Response with match details

**Response**:
```json
{
  "status": "matched",
  "call_id": "uuid",
  "session_id": "uuid",
  "lead_score": 75
}
```

### 7.3 `/api/create-test-site` (POST)

**Purpose**: Create test site for development/testing

**Authentication**: Required (user must be logged in)

**Process**:
1. Check if user already has a site
2. Generate unique `public_id` based on user ID
3. Create site record
4. Return site details

**Use Case**: Dashboard setup for new users

---

## 8. Client-Side Tracker (`public/assets/core.js`)

**Note**: Legacy path `public/ux-core.js` maintained for backwards compatibility. New implementations should use `/assets/core.js` for ad-blocker avoidance.

### 8.1 Initialization

- Loaded via `<script data-site-id="...">` tag
- Prevents duplicate initialization (`window.opmantik._initialized`)
- Generates UUID v4 session ID (RFC 4122 compliant)
- Creates browser fingerprint (canvas + user agent + screen + timezone)
- Extracts GCLID from URL parameters

### 8.2 Session Management

- **Storage**: `sessionStorage.getItem('opmantik_session_sid')`
- **Fingerprint**: `localStorage.getItem('opmantik_session_fp')` (persists across sessions)
- **GCLID**: `sessionStorage.getItem('opmantik_session_context')`
- **Migration**: Automatically migrates old `sess_*` format to UUID v4

### 8.3 Auto-Tracking

**Automatic Events**:
- Page view on load
- Phone link clicks (`tel:` links)
- WhatsApp link clicks (`wa.me`, `whatsapp.com`)
- Form submissions
- Scroll depth (50%, 90%)
- Heartbeat (every 30 seconds)
- Session end (on `beforeunload`)

**Manual Tracking**:
```javascript
window.opmantik.send('conversion', 'cta_click', 'pricing_cta');
```

### 8.4 Event Sending

- Fire-and-forget `fetch()` requests
- Compressed payload format
- Error handling with console warnings
- Success logging for debugging

---

## 9. Security Architecture

### 9.1 Authentication

- **Provider**: Supabase Auth (Google OAuth)
- **Flow**: OAuth callback → session creation → dashboard access
- **Session Management**: Server-side session cookies

### 9.2 Row Level Security (RLS)

- **Enabled**: All tables (`sites`, `sessions`, `events`, `calls`, `user_credentials`)
- **Pattern**: Users can only access data through their site ownership
- **Query Requirement**: JOIN pattern required for `events` and `calls` queries
- **Bypass**: Service role key used in API routes (admin client)

### 9.3 API Security

- **Service Role Key**: Only in server-side API routes (never exposed to client)
- **Anon Key**: Used in client components (RLS enforced)
- **CORS**: Configurable origin whitelist
- **Rate Limiting**: Per-IP rate limits on all endpoints

### 9.4 Data Privacy

- **Fingerprinting**: Client-side only, no PII in fingerprint
- **IP Address**: Stored but not used for identification
- **GCLID**: Google-provided identifier, stored for attribution
- **Phone Numbers**: Only stored when call matching occurs

---

## 10. Performance Optimizations

### 10.1 Database

- **Partitioning**: Monthly partitions for `sessions` and `events`
- **Indexes**: Strategic indexes on foreign keys, partition keys, and query filters
- **Query Optimization**: JOIN patterns optimized for RLS compliance
- **Connection Pooling**: Supabase handles connection pooling

### 10.2 Client-Side

- **Event Batching**: Not implemented (fire-and-forget per event)
- **Debouncing**: Scroll depth tracking debounced
- **Caching**: Session ID and fingerprint cached in browser storage
- **Lazy Loading**: Dashboard components load data on mount

### 10.3 Real-Time

- **Subscription Management**: Proper cleanup on component unmount
- **Filtering**: Partition-based filtering reduces unnecessary events
- **Verification**: RLS verification on each real-time event (JOIN pattern)

---

## 11. Scalability Considerations

### 11.1 Current Capacity

- **Partitioning**: Handles millions of events per month
- **Real-Time**: Supabase Realtime scales automatically
- **Database**: PostgreSQL on Supabase (managed scaling)

### 11.2 Future Optimizations

- **Event Batching**: Batch multiple events in single API call
- **Materialized Views**: Pre-aggregated stats for faster dashboard loads
- **Archive Strategy**: Move old partitions to cold storage
- **CDN**: Serve tracker script via CDN for global performance

---

## 12. Monitoring & Debugging

### 12.1 Logging

**Server-Side** (API routes):
- `[SYNC_API]` - Event processing logs
- `[SYNC_VALID]` - Site validation logs
- `[CREATE_TEST_SITE]` - Site creation logs

**Client-Side** (Components):
- `[LIVE_FEED]` - Real-time subscription logs
- `[SESSION_GROUP]` - Call matching logs
- `[TEST_PAGE]` - Tracker initialization logs

**Tracker Script**:
- `[OPSMANTIK]` - Event sending logs

### 12.2 Error Handling

- **API Routes**: Comprehensive try-catch with detailed error messages
- **Client Components**: Error boundaries and fallback UI
- **Tracker Script**: Silent failures with console warnings

---

## 13. Technology Stack

### 13.1 Backend

- **Framework**: Next.js 14+ (App Router)
- **Database**: PostgreSQL (Supabase)
- **Real-Time**: Supabase Realtime (PostgreSQL logical replication)
- **Authentication**: Supabase Auth (Google OAuth)
- **API**: Next.js API Routes (Edge Runtime compatible)

### 13.2 Frontend

- **Framework**: Next.js 14+ (React Server Components + Client Components)
- **Styling**: Tailwind CSS v4 (CSS variables, `@theme` directive)
- **UI Components**: Shadcn UI (Radix UI primitives)
- **Icons**: Lucide React
- **Fonts**: Inter, JetBrains Mono (via `next/font/google`)

### 13.3 Infrastructure

- **Hosting**: Vercel (Next.js deployment)
- **Database**: Supabase (PostgreSQL + Realtime)
- **CDN**: Vercel Edge Network (for static assets)

---

## 14. Known Limitations & Future Work

### 14.1 Current Limitations

1. **Geo-Location**: Currently defaults to 'Unknown' (removed `geoip-lite` for Edge Runtime compatibility)
2. **Event Batching**: Not implemented (one API call per event)
3. **Archive Strategy**: Old partitions not automatically archived
4. **Materialized Views**: Stats calculated on-demand (could be pre-aggregated)

### 14.2 Future Enhancements

1. **Google Ads API Integration**: Use `user_credentials` to fetch campaign data
2. **Advanced Attribution**: Implement time-decay, position-based models
3. **Machine Learning**: Predictive lead scoring based on historical data
4. **Export/Reporting**: CSV/PDF export of analytics data
5. **Webhooks**: Real-time webhooks for external integrations

---

## 15. Deployment Checklist

- [ ] Environment variables configured (`.env.local`)
- [ ] Supabase migrations applied (`supabase db push`)
- [ ] Realtime publication enabled
- [ ] RLS policies verified
- [ ] Test site created
- [ ] Tracker script tested
- [ ] Dashboard authentication working
- [ ] Real-time subscriptions active
- [ ] Phone call matching tested

---

**Report Generated**: 2026-01-25
**System Version**: OPSMANTIK v1.0
**Database Schema Version**: 20260125000000_initial_schema.sql

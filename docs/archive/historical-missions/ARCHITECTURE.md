# 🏛️ OPSMANTIK - Divine Architecture (Proje Anayasası)

## 📐 Core Principles

### 1. Monthly Partitioning Strategy
- **Sessions**: Partitioned by `created_month` (e.g., `sessions_2026_01`)
- **Events**: Partitioned by `session_month` (e.g., `events_2026_01`)
- **Critical**: ALL inserts MUST include `session_month` or `created_month`
- **Partition Creation**: Automatic via migration DO block

### 2. Realtime Engine
- **Publication**: `supabase_realtime` (global, all tables)
- **REPLICA IDENTITY**: `FULL` (required for partitioned tables)
- **Subscriptions**: 
  - `public:events` - Real-time event stream
  - `public:calls` - Real-time phone call matches
  - `public:sessions` - Session updates

### 3. Phone Matching Logic
- **Table**: `calls`
- **Matching**: Via `fingerprint` in events metadata
- **Endpoint**: `/api/call-event`
- **Time Window**: 30 minutes
- **Lead Score**: Calculated from session events

### 4. Lead Scoring (0-100)
- **Conversion**: +50 points
- **Interaction**: +10 points
- **Scroll Depth 50%**: +10 points
- **Scroll Depth 90%**: +20 points
- **Hover Intent**: +15 points
- **Google Referrer**: +5 points
- **Returning Ad User**: +25 points
- **Cap**: Maximum 100

### 5. Multi-Touch Attribution
- **First Click (Paid)**: GCLID present in URL
- **Return Visitor (Ads Assisted)**: Fingerprint match with past GCLID
- **Organic**: No GCLID, no past match

### 6. Security (RLS)
- **Enabled**: All tables (sites, sessions, events, calls, user_credentials)
- **Policy Pattern**: Users can only see their own sites' data
- **Query Pattern**: Always filter by `user_id` → `site_id` → data

## 🗄️ Database Schema

### Tables

#### `sites`
- Multi-tenant site ownership
- `user_id` → `auth.users(id)`
- `public_id` - External identifier (used in tracker)

#### `sessions` (PARTITIONED)
- Traffic pool
- Partition key: `created_month`
- Composite PK: `(id, created_month)`
- FK: `site_id` → `sites(id)`

#### `events` (PARTITIONED)
- Action log
- Partition key: `session_month`
- Composite FK: `(session_id, session_month)` → `sessions(id, created_month)`
- `metadata` JSONB: Stores fingerprint, device info, geo, scoring

#### `calls`
- Phone call records
- `matched_session_id` - Links to session
- `matched_fingerprint` - Matching key
- `lead_score` - Calculated score

#### `user_credentials`
- OAuth tokens (Google Ads API)
- Encrypted storage recommended

## 🔄 Realtime Subscription Pattern

```typescript
// Subscribe to events
const eventsChannel = supabase
  .channel('events')
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'events',
    filter: `session_month=eq.${currentMonth}`
  }, (payload) => {
    // Handle new event
  })
  .subscribe();

// Subscribe to calls
const callsChannel = supabase
  .channel('calls')
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'calls'
  }, (payload) => {
    // Handle new call match
  })
  .subscribe();
```

## 🎯 API Endpoints

### `/api/sync` (POST)
- **Purpose**: Event tracking
- **Rate Limit**: 100 req/min
- **Payload**: Compressed format (s, u, sid, sm, ec, ea, el, ev, meta, r)
- **Response**: `{ status: 'synced', score: leadScore }`

### `/api/call-event` (POST)
- **Purpose**: Phone call matching
- **Rate Limit**: 50 req/min
- **Payload**: `{ site_id, phone_number, fingerprint }`
- **Response**: `{ status: 'matched', call_id, session_id, lead_score }`

## 🔐 Security Checklist

- ✅ RLS enabled on all tables
- ✅ Service role key only in API routes
- ✅ Anon key in client components
- ✅ User context always verified
- ✅ Site ownership validated

## 📊 Query Patterns

### Get User's Events
```sql
SELECT e.* FROM events e
JOIN sessions s ON s.id = e.session_id AND s.created_month = e.session_month
JOIN sites st ON st.id = s.site_id
WHERE st.user_id = auth.uid()
ORDER BY e.created_at DESC
LIMIT 100;
```

### Get Session Events
```sql
SELECT * FROM events
WHERE session_id = $1
  AND session_month = $2
ORDER BY created_at ASC;
```

## 🚨 Critical Rules

1. **NEVER** insert events without `session_month`
2. **ALWAYS** validate site ownership via RLS
3. **ALWAYS** use current month partition for queries
4. **ALWAYS** include `session_month` in event queries
5. **NEVER** expose service role key to client

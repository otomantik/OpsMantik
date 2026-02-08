# OpsMantik - System Architecture

## 📐 Core Design Principles

### 1. Monthly Database Partitioning
To ensure long-term performance and manageable data growth, the core time-series tables are partitioned by month.
- **Sessions Table**: Partitioned by `created_month` (formatted as `YYYY-MM-01`).
- **Events Table**: Partitioned by `session_month` (matches the parent session's month).
- **Rule**: Every `INSERT` operation must explicitly include the partition key (`session_month` or `created_month`).
- **Management**: Partitions are created automatically via PostgreSQL migrations (`DO` blocks).

### 2. Real-time Ingestion Pipeline
The system handles high-frequency tracking events through an asynchronous queue.
- **Ingestion Path**: `/api/sync` (Next.js Edge/Node) → QStash (Queuing) → `/api/sync/worker` (Processing).
- **Database Identity**: Tables use `REPLICA IDENTITY FULL` to support CDC (Change Data Capture) and real-time subscriptions across partitions.

### 3. Intent Engine & Lead Scoring
Visitor behavior is analyzed in real-time to calculate a "Lead Score" (0-100).
- **Signal Weights**:
  - Primary Conversion (Call/WhatsApp): +50 pts
  - Interaction: +10 pts
  - Scroll Depth (50%): +10 pts
  - Scroll Depth (90%): +20 pts
  - Hover Intent (CTA): +15 pts
  - Google Referrer: +5 pts
  - Returning User (Ad Assisted): +25 pts
- **Cap**: Maximum score is normalized to 100.

### 4. Attribution Logic
- **Direct-to-Ads**: GCLID present in the current session URL.
- **Ads-Assisted**: No GCLID in current session, but fingerprint matches a historical session with a GCLID.
- **Organic/Referral**: No current or historical GCLID association.

### 5. Multi-Tenant Security (RLS)
- **Supabase Row Level Security (RLS)** is enabled on all critical tables.
- **Isolation**: Policies ensure a user can only query/modify data belonging to their `site_id`, verified against their `auth.uid()`.

## 🗄️ Database Schema Overview

### Core Tables
- **`sites`**: Global site configuration and ownership.
- **`sessions`**: Root of the traffic pool. Stores device metadata and co-ordinates attribution.
- **`events`**: High-volume action log. Stores behavior data in a `metadata` JSONB blob.
- **`calls`**: Conversion records. Links external call events to tracked sessions via `matched_fingerprint`.

## 🔄 Real-time Subscription Usage
Developers should subscribe to specific partitions for efficiency.
```typescript
const channel = supabase
  .channel('live-events')
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'events',
    filter: `session_month=eq.${currentMonth}`
  }, (payload) => {
    // UI Update Logic
  })
  .subscribe();
```

## 🚨 Critical Constraints
1. **Never** perform event insertion without `session_month`.
2. **Always** include partition keys in queries to avoid full-table scans.
3. **Never** expose the `service_role` key to the client browser.
4. **Always** validate `site_id` existence before processing.

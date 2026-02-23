# OpsMantik - Operations & Maintenance

## 📊 SLA & SLO Specification
*Refer to the specialized SLA document for detailed metric definitions.*

OpsMantik is mission-critical for conversion attribution. Reliability is prioritized over features.
- **Availability Target**: 99.9% for ingestion pipelines.
- **Error Budget**: Exhausting the error budget results in a mandatory feature freeze.

## 🚀 Deployment & Scaling

### Vercel Infrastructure
- **Serverless Functions**: Used for API endpoints and background workers.
- **Edge Runtime**: Used for lightweight routing and redirects where applicable.
- **Cold Starts**: Accepted within 2s for early production; sustained issues trigger a move to ISR or higher-tier plan.

### PostgreSQL (Supabase) Scaling
- **Partitioning**: Monthly partitions ensure that individual table sizes stay below performance thresholds.
- **Auto-Scale**: Database is configured to vertically scale under high concurrent query load.

## 🛡️ Monitoring & Observability

### Watchtower (Internal Monitor)
- **Path**: `/api/cron/watchtower`
- **Frequency**: Every 15 minutes via Vercel Cron.
- **Rules**:
  - Alert if Total Ingested Sessions (1h) = 0.
  - Alert if GCLID Ingested (3h) = 0.

### Sentry (Error Tracking)
- All server-side and client-side exceptions are captured in Sentry.
- **PII Scrubbing**: Sentry is configured to automatically scrub PII (emails, IPs, card numbers) from logs to maintain GDPR/KVKK compliance.

## 🔧 Maintenance Runbooks (Common Issues)

### 1. 500 Error on /api/sync
- **Check**: Supabase logs for unique constraint violations on `processed_signals`.
- **Fix**: Verify deduplication logic in the sync worker.

### 2. Zero GCLIDs Reported
- **Check**: Site tracker version (ensure `ux-core.js` is V2).
- **Check**: URL parameters are being passed through correctly from Google Ads.
- **Check**: `Watchtower` for liveness status.

### 3. High Latency (>500ms)
- **Check**: Database query performance (Materialized Views).
- **Check**: Vercel Region (Ensure users are hitting the nearest edge node).

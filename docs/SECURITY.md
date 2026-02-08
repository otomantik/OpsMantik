# OpsMantik - Security & Privacy Policy

## 🔒 Platform Security Architecture

### 1. Multi-Tenant Isolation
- **Row Level Security (RLS)**: Every table in the Supabase database is protected by RLS.
- **Verification**: Policies ensure that an authenticated user can only access data where `user_id` matches their own, or where they belong to the `site_id` owner group.
- **Service Role**: The `service_role` key is strictly confined to server-side API routes and background workers. It is **never** exposed to the client-side.

### 2. API Security (Fail-Closed)
- **CORS Management**: The platform uses a "Fail-Closed" CORS architecture. If a domain is not explicitly listed in the `ALLOWED_ORIGINS` environment variable, the request is blocked before processing.
- **Signature Verification**: The `/api/call-event/v2` endpoint requires an HMAC-SHA256 signature calculated with a site-specific secret, preventing conversion signal spoofing.
- **Ingestion Protection**: The background worker (`/api/sync/worker`) validates Upstash QStash signatures to ensure only tasks from our own producer are processed.

### 3. Rate Limiting & DoS Protection
- **Redis-Backed Limits**: Public endpoints (`/api/sync`, `/api/call-event`) use Upstash Redis to track and limit requests per IP address per minute.
- **Serverless Scaling**: Vercel infrastructure automatically scales to handle traffic spikes, while QStash buffers high-volume ingestion to protect the database from connection exhaustion.

## 🛡️ Data Privacy & Compliance

### 1. PII Scrubbing
- **Privacy Shield**: The system is designed to avoid storing sensitive Personally Identifiable Information (PII) wherever possible.
- **Sentry Filtering**: Sentry is configured with `sendDefaultPii: false`. All error logs are scrubbed of emails, credit card numbers, and authorization tokens before being transmitted to Sentry servers.

### 2. Data Retention
- **Audit Logs**: Administrative actions (Undo, Seal, Junk) are recorded in `call_actions` for audit purposes.
- **Session Lifespan**: Tracker sessions expire after 30 minutes of inactivity to minimize persistent tracking.

## 📋 Security Checklist for Developers
- [ ] Always enable RLS on new database tables.
- [ ] Ensure `validateSiteAccess` is called for any endpoint accepting a `site_id`.
- [ ] Never prefix secret keys with `NEXT_PUBLIC_`.
- [ ] Use `timingSafeCompare` for any sensitive token/key comparison.
- [ ] Regularly review `Watchtower` logs for unusual ingestion patterns.

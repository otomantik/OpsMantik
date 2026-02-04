# Auto-Approve (Auto-Seal) Job — Scheduling

The **auto-approve** job marks low-risk, stale intents as `confirmed` after 24 hours so they can be exported to Google (OCI) even if the dealer never opens the dashboard. It is **not** invoked by any built-in cron; you must schedule it yourself.

## What the job does

- **Endpoint:** `POST /api/jobs/auto-approve`
- **Body:** `{ "siteId": "<uuid>", "minAgeHours": 24, "limit": 200 }` (minAgeHours and limit optional)
- **Auth:** Requires an authenticated user with access to the site, or use a server-side cron with a user/session that has access. The RPC also allows `service_role` for server-side schedulers.
- **Behaviour:**
  - Selects intents that are older than `minAgeHours`, have `status = 'intent'` (or NULL), and are **low-risk**: session has GCLID (or wbraid/gbraid), `total_duration_sec >= 10`, `event_count >= 2`.
  - Updates only those rows to `status = 'confirmed'`, `oci_status = 'sealed'`, and a default `lead_score` (3 stars). **It never sets status to junk;** uncertain leads stay pending.

## How to schedule

### Option A: Vercel Cron (recommended if you use Vercel)

1. Add a cron in `vercel.json`:
   ```json
   {
     "crons": [
       {
         "path": "/api/jobs/auto-approve",
         "schedule": "0 4 * * *"
       }
     ]
   }
   ```
2. The route currently expects a body with `siteId`. So either:
   - Create a **wrapper** route (e.g. `/api/cron/auto-approve-all`) that lists all sites (with service role or a system user), then calls `POST /api/jobs/auto-approve` for each site, or
   - Run one cron per site (e.g. via Vercel Cron with different paths or env-based site IDs) if you have a small, fixed set of sites.

### Option B: External cron (e.g. cron-job.org, GitHub Actions)

- **Once per day**, send a `POST` request to `https://<your-domain>/api/jobs/auto-approve` with:
  - Headers: `Content-Type: application/json`, and either a valid session cookie / Bearer token for a user who has access to the site, or implement a dedicated “cron secret” in a wrapper route that uses service role and iterates sites.
  - Body: `{ "siteId": "<site-uuid>" }` (and optionally `minAgeHours`, `limit`).

To run for **all sites**, use a small script or API route that:
1. Lists site IDs (e.g. from `sites` table with service role).
2. For each site, calls the auto-approve logic (same RPC or same endpoint with that `siteId`).

### Option C: pg_cron + pg_net (Supabase)

If you run Supabase with `pg_cron` and `pg_net` enabled, you can schedule an HTTP request from the database. You would need a publicly callable URL that authenticates (e.g. a secret in the URL or a serverless function that checks a cron secret and then loops over sites and calls the RPC). Document that URL and schedule it from `pg_cron` (e.g. daily at 04:00).

## Summary

| Item | Detail |
|------|--------|
| **RPC** | `auto_approve_stale_intents_v1` — low-risk only (GCLID + duration ≥10s + events ≥2); sets `confirmed`, never `junk`. |
| **Default lead_score** | 60 (3 stars on 0–100 scale) for OCI value. |
| **Schedule** | Once per day per site (or one job that loops over sites). |

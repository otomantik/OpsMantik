# Watchtower — Hourly Health Checks (Hobby-safe)

## What it is

Watchtower is a lightweight "dead man's switch" for production ingestion:
- **sessionsLastHour**: alarm if zero sessions were ingested in the last 1 hour
- **gclidLast3Hours**: alarm if zero sessions with `gclid` were ingested in the last 3 hours

Endpoint: `GET /api/cron/watchtower` (server-side; uses `WatchtowerService.runDiagnostics()`).

## Why GitHub Actions (hourly)

Vercel Hobby cron has limitations. We keep **Vercel cron daily** (optional) and run the **hourly trigger** via GitHub Actions schedule.

## GitHub Actions workflow

Workflow file: `.github/workflows/watchtower.yml`

Schedule: `0 * * * *` (hourly at minute 0, UTC)

### Required GitHub Secrets

Add these in **GitHub → Repo → Settings → Secrets and variables → Actions**:

- **`WATCHTOWER_BASE_URL`**: production base URL  
  Example: `https://console.opsmantik.com`

- **`WATCHTOWER_CRON_SECRET`**: the same bearer secret used by the API route  
  Must match server env `CRON_SECRET`.

### What the workflow does

It calls:

- `GET ${WATCHTOWER_BASE_URL}/api/cron/watchtower`
- With header: `Authorization: Bearer ${WATCHTOWER_CRON_SECRET}`

Expected:
- **200 OK** with JSON payload including `status: "ok" | "alarm"`
- If misconfigured secret: **401 Unauthorized**
- If `CRON_SECRET` missing in production: **500** (fail-closed)

## Vercel cron (daily)

Config: `vercel.json`

Currently:
- `/api/cron/watchtower` daily at `0 6 * * *` (UTC)

If you are on Hobby and want to rely solely on GitHub Actions, you can remove the Vercel cron entry (or keep it daily as a backstop).

## Manual proof (production)

From your machine:

```bash
curl -sS -H "Authorization: Bearer $CRON_SECRET" \
  "https://console.opsmantik.com/api/cron/watchtower"
```

Proof checklist:
- Response is **200**
- JSON has `checks.sessionsLastHour.count` and `checks.gclidLast3Hours.count`
- If any check is alarm, you see `status: "alarm"` and notification path is invoked by the service


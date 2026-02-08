# RUNBOOK — No Sessions Ingested (sessionsLastHour = 0)

## Scope

Production only. Primary ingestion path:
- `POST /api/sync` (producer)
- `POST /api/sync/worker` (QStash consumer)

## Symptoms

- Watchtower reports `sessionsLastHour.count = 0` (alarm).
- Dashboard shows flatline (no new sessions).
- Customer reports tracking stopped.

## Immediate checks (5 minutes)

1. **Health**

```bash
curl -sS https://console.opsmantik.com/api/health
```

Expected: `ok: true` and ideally `db_ok: true`.

2. **Confirm DB reality (not just UI)**

Supabase SQL Editor:

```sql
SELECT COUNT(*)::int AS sessions_last_60m
FROM public.sessions
WHERE created_at >= NOW() - INTERVAL '60 minutes';
```

Expected:
- If `0`, ingestion is truly stalled.
- If `>0`, UI/reporting issue (not this runbook).

3. **Vercel logs: `/api/sync`**
- Look for:
  - spikes in 4xx/5xx
  - `QSTASH_PUBLISH_ERROR`
  - CORS rejects (“Origin not allowed”)

4. **Sentry**
- Filter errors for routes:
  - `/api/sync`
  - `/api/sync/worker`

## Commands to run

### A) `/api/sync` diagnostic mode (safe)

```bash
curl -sS "https://console.opsmantik.com/api/sync?diag=1" | jq .
```

Expected:
- `ok: true`
- `headers_present` indicates whether geo headers are being received

### B) Verify QStash env configuration (prod)

In Vercel env (Production):
- `QSTASH_TOKEN`
- `QSTASH_CURRENT_SIGNING_KEY`
- `QSTASH_NEXT_SIGNING_KEY`

If missing, the worker verification and/or producer publish path will break.

### C) Verify partition drift guards (common ingestion killer)

From your machine (needs prod Supabase URL + service role in env):

```bash
node scripts/verify-partition-triggers.mjs
```

Expected:
- `Partition triggers OK ...`

If missing:
- sessions/events partition keys may stop populating correctly → inserts/joins can break downstream.

## Mitigation

### 1) CORS rejecting ingestion
- If Vercel logs show 403 “Origin not allowed”, fix `ALLOWED_ORIGINS` and redeploy.
- See `RUNBOOK_CORS_INCIDENT.md`.

### 2) QStash publish failing (producer)
- If logs show `QSTASH_PUBLISH_ERROR`:
  - validate QStash env vars
  - check Upstash/QStash status
  - mitigation: restore env + redeploy

### 3) QStash worker failing (consumer)
- If worker errors spike:
  - check QStash signing keys
  - check Supabase service role key
  - check DB RPC/trigger drift

### 4) DB instability / auth misconfig
- If `db_ok=false` or Supabase errors:
  - verify Supabase project health
  - verify Vercel env keys (`NEXT_PUBLIC_SUPABASE_URL`, anon key, service role key where used)

## Rollback

- Roll back last deploy if regression.
- If env change caused outage, revert env + redeploy.

## Proof / Acceptance checklist

- [ ] `sessions_last_60m > 0` in Supabase SQL.
- [ ] `/api/sync` returns 200 for real customer traffic (Vercel logs confirm).
- [ ] `/api/sync/worker` error rate returns to baseline (Sentry).
- [ ] Watchtower shows `sessionsLastHour.status = ok`.
- [ ] Dashboard shows new sessions within normal delay.


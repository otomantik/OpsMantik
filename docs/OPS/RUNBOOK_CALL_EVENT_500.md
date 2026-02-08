# RUNBOOK — Call-Event 5xx (500/502/504)

## Scope

Production only. Endpoints:
- `POST /api/call-event`
- `POST /api/call-event/v2`

## Symptoms

- Customer reports WhatsApp/phone clicks are **not showing** in dashboard/queue.
- Browser Network shows **5xx** from `.../api/call-event` or `.../api/call-event/v2`.
- Vercel shows elevated **5xx** for call-event routes.
- Sentry shows exceptions tagged with `route=/api/call-event` or `route=/api/call-event/v2`.

## Immediate checks (5 minutes)

1. **Health**

```bash
curl -sS https://console.opsmantik.com/api/health
```

Expected:
- `ok: true`
- `db_ok: true` (best-effort; if `false`, treat as incident across the stack)

2. **Confirm it’s 5xx (not 401/403/400)**

- 401 → signing/auth issue (see `docs/OPS/CALL_EVENT_401_AND_GOOGLE_ADS.md`)
- 403 → CORS / Origin not allowed (see `RUNBOOK_CORS_INCIDENT.md`)
- 400 → invalid body (check response `hint` if present)
- 5xx → continue below

3. **Sentry: find the top exception**
- Filter by route tag:
  - `/api/call-event` or `/api/call-event/v2`
- Capture:
  - exception type + message
  - first stack frame in app code
  - deploy SHA (`VERCEL_GIT_COMMIT_SHA`)

4. **Vercel logs: error correlation**
- Filter logs by route and `level=error`.
- Look for:
  - Supabase insert/update failures
  - RPC missing (`resolve_site_identifier_v1`, etc.)
  - rate-limit/replay-cache failures (Upstash)

## Commands to run (prod debugging)

### A) Reproduce with curl (unsigned / CORS-free)

If you can use a trusted origin and you’re testing the API directly, set a safe Origin that exists in `ALLOWED_ORIGINS`:

```bash
ORIGIN="https://www.sosreklam.com"
curl -sS -i \
  -H "Origin: $ORIGIN" \
  -H "Content-Type: application/json" \
  --data '{"site_id":"<site_public_id_or_uuid>","fingerprint":"rb_fp","intent_action":"phone","intent_target":"905000000000","intent_stamp":"rb-test-123"}' \
  https://console.opsmantik.com/api/call-event/v2
```

Expected:
- `200` with JSON (matched/noop/etc.) OR
- `401/403/400` with clear body
If you get `5xx`, capture response body + request id (if present) + timestamp.

### B) Supabase: validate writes are happening

In Supabase SQL Editor (prod), for the affected `site_id` (UUID):

```sql
SELECT id, created_at, source, status, intent_action, intent_stamp
FROM public.calls
WHERE site_id = '<SITE_UUID>'
ORDER BY created_at DESC
LIMIT 20;
```

Expected:
- New rows appear when reproducing.

## Mitigation

Choose the smallest safe mitigation based on root cause.

### 1) Supabase/RPC missing or failing
- If error indicates missing RPC/column: deploy DB migration first (or hotfix RPC).
- If failing due to RLS: call-event routes use admin/service role; verify `SUPABASE_SERVICE_ROLE_KEY` is present and correct in Vercel env.

### 2) Upstash Redis / Replay / Rate limit instability
- If Upstash is down: endpoints should degrade (some paths may fail-closed).
- Temporarily reduce strictness only if documented and approved (rate limit modes differ across routes).

### 3) CORS misconfiguration causing upstream failures
- If failures correlate with a single customer domain, treat as CORS incident: use `RUNBOOK_CORS_INCIDENT.md`.

### 4) Recent deploy regression
- Roll back to last known good SHA in Vercel.
- Re-test reproduction curl.

## Rollback

- Vercel rollback to previous production deployment.
- If DB migration is culprit and reversible, roll back migration (only if safe and you have a tested rollback path).

## Proof / Acceptance checklist

- [ ] Sentry 5xx exception rate drops to baseline.
- [ ] Vercel logs show `POST /api/call-event(/v2)` returning mostly 2xx.
- [ ] Repro curl returns 200 (or expected 4xx with correct message).
- [ ] New rows appear in `public.calls` for the affected site.
- [ ] Dashboard queue shows new intents for that site within the expected time window.


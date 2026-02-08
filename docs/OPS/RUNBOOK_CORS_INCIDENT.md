# RUNBOOK — CORS Incident (403 Origin not allowed)

## Scope

Production only. Affects endpoints that enforce `ALLOWED_ORIGINS`, typically:
- `POST /api/sync`
- `POST /api/call-event` / `POST /api/call-event/v2`

## Symptoms

- Browser console: CORS errors / blocked requests.
- Network: request returns **403** with body like `Origin not allowed`.
- Only one or a few customer domains affected.
- Dashboard shows missing sessions/calls only for specific sites.

## Immediate checks (5 minutes)

1. **Identify failing endpoint and exact Origin**
- In customer browser DevTools → Network, capture:
  - Request URL
  - Response status/body
  - `Origin` header value (must be exact scheme + host)

2. **Confirm server is healthy**

```bash
curl -sS https://console.opsmantik.com/api/health
```

3. **Check Vercel logs**
- Filter route and look for 403 spikes.
- Confirm `origin` in the log context if available.

## Commands to run (prod-safe)

### A) Reproduce 403 with curl

```bash
ORIGIN="https://customer.example.com"
curl -sS -i \
  -H "Origin: $ORIGIN" \
  -H "Content-Type: application/json" \
  --data '{"ok":true}' \
  https://console.opsmantik.com/api/sync
```

Expected (when blocked):
- `403` with JSON containing `Origin not allowed` (exact message varies).

### B) For call-event/v2

```bash
ORIGIN="https://customer.example.com"
curl -sS -i \
  -H "Origin: $ORIGIN" \
  -H "Content-Type: application/json" \
  --data '{"site_id":"<public_id_or_uuid>","fingerprint":"cors_fp","intent_action":"phone","intent_target":"905000000000","intent_stamp":"cors-test-1"}' \
  https://console.opsmantik.com/api/call-event/v2
```

Expected:
- `403` if origin not allowed.

## Mitigation

### Fix `ALLOWED_ORIGINS` (primary)

In Vercel Production environment variables:
- Add the exact origin(s), comma-separated:
  - `https://www.customer.com`
  - `https://customer.com`

Rules:
- Must include scheme (`https://`).
- No wildcards in production (fail-closed posture).

After update:
- Redeploy (or trigger a new deploy) so runtime picks up env changes.

### If using unsigned call-event mode (exceptional)
If `CALL_EVENT_SIGNING_DISABLED=1` is used, CORS becomes the main guardrail. Keep `ALLOWED_ORIGINS` strict.

## Rollback

- Revert `ALLOWED_ORIGINS` to last known good value.
- Redeploy.

## Proof / Acceptance checklist

- [ ] Customer browser requests return 200/2xx (no CORS errors).
- [ ] Vercel logs: 403 rate returns to baseline.
- [ ] Supabase shows new `sessions` and/or `calls` rows for the affected site after a test.
- [ ] Dashboard reflects new traffic/calls for the affected window.


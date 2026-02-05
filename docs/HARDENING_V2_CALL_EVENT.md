# OpsMantik V2 Call-Event Hardening (DUAL mode)

## Goals
- **Browser never sees secrets** in V2 (proxy-first).
- Maintain **backward compatibility** for V1 (browser-signed) during rollout.
- Add **site-id normalization**, **idempotency**, **replay cache**, and **per-site rate limiting**.
- Enforce rule: **auth verification happens before any service-role DB access**.

## Current flows (as of this doc)

### V1 (legacy, browser-signed)
- **Tracker**: `public/assets/core.js`, `public/ux-core.js`
- **Endpoint**: `POST /api/call-event`
- **Auth**: HMAC-SHA256 signature over `${ts}.${rawBody}`
  - Headers: `X-Ops-Site-Id`, `X-Ops-Ts`, `X-Ops-Signature`
  - Secrets stored in DB (`private.site_secrets`); verification via `public.verify_call_event_signature_v1(...)` returning boolean only
- **CORS**: strict allowlist via `lib/cors.ts`
- **Rate limit**:
  - IP+UA degraded limiter (coarse)
  - **Per-site degraded limiter** (`site_uuid|clientId`)
- **Replay**:
  - Timestamp window (API + DB verifier)
  - **Replay cache (10m TTL)** keyed by canonical site UUID + `event_id` (preferred) or signature
- **Idempotency**:
  - `calls.event_id` (optional) with unique index `(site_id,event_id)` when provided
  - Unique conflicts return **200 noop** with existing call when found

### V2 (preferred, proxy-signed)
- **Endpoint**: `POST /api/call-event/v2`
- **Intended caller**: first-party proxy on the customer domain (e.g., WordPress)
- **Auth**: same HMAC signature contract as V1
  - Includes informational `X-Ops-Proxy: 1`
  - Proxy also forwards `X-Ops-Proxy-Host` (best-effort) for rate-limit blast-radius isolation
- **CORS**:
  - If `Origin` exists → enforced allowlist
  - If no `Origin` (server-to-server) → allowed
- **Rate limit**: degraded per-site + proxy host (`site_uuid|proxyHost|clientId`)
- **Replay + idempotency**: same behavior as V1

## DUAL mode tracker behavior
Tracker prefers proxy-first:
- If `data-ops-proxy-url` exists → send **unsigned** JSON to customer proxy endpoint (same-origin friendly).
- Else if `data-ops-secret` exists → send **signed** request to console `/api/call-event` (legacy V1 fallback).
- Else → do not send; only debug log (if enabled).

### Preferred embed example (V2)

```html
<script
  src="https://console.opsmantik.com/assets/core.js"
  data-ops-site-id="YOUR_SITE_PUBLIC_ID_32HEX_OR_UUID"
  data-ops-proxy-url="https://YOURDOMAIN.com/wp-json/opsmantik/v1/call-event"
></script>
```

## Secrets & rotation
- Secrets live in `private.site_secrets` (not readable by anon/authenticated).
- Verifier RPC: `public.verify_call_event_signature_v1(...)` returns boolean only; **secrets never leave DB**.
- Rotation is supported via `current_secret` + `next_secret` (see migrations + admin RPCs).

## Environment variables
- **Critical**
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- **Optional rollback**
  - `CALL_EVENT_SIGNING_DISABLED=1` (rollback only)
    - In production, `/api/health` will surface `signing_disabled: true` and emit a one-time Sentry warning per boot.
- **Rate limiting (Upstash)**
  - `UPSTASH_REDIS_REST_URL`
  - `UPSTASH_REDIS_REST_TOKEN`

## Troubleshooting
- **401 Unauthorized**:
  - Signature mismatch, wrong site id, or timestamp drift.
  - Ensure proxy uses correct secret and forwards the exact raw JSON body it signed.
- **400 Invalid site_id**:
  - `site_id` not resolvable by `public.resolve_site_identifier_v1` (unknown UUID/public_id).
- **200 { status: "noop" }**:
  - Duplicate `event_id` / replay detected (expected for retries).
- **429 Rate limit exceeded**:
  - Per-site limiter tripped (check proxy host and clientId).

## Proof / How to verify
- **Unit tests**:

```bash
node --import tsx --test tests/unit/*.test.ts
```

- **Build**:

```bash
npm run build
```


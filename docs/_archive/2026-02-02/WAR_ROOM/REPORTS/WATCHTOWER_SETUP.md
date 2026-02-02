# Watchtower — Error Tracking & Health (GO W1 + W2)

## Environment variables

### Error tracking (Sentry / GlitchTip)

| Variable | Where | Description |
|--------|--------|-------------|
| `NEXT_PUBLIC_SENTRY_DSN` | Client + server | DSN for Sentry or GlitchTip (public; used in browser). |
| `SENTRY_DSN` | Server / edge | Optional override for server/edge (falls back to `NEXT_PUBLIC_SENTRY_DSN`). |
| `OPSMANTIK_RELEASE` | Server / edge | Release/version tag (e.g. commit SHA). Used for grouping in Sentry. |
| `NEXT_PUBLIC_OPSMANTIK_RELEASE` | Client | Optional; use if you need the same release tag in the client bundle. |
| `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA` | Client | Vercel injects this; used as release when `NEXT_PUBLIC_OPSMANTIK_RELEASE` is unset. |
| `SENTRY_ORG` | Build | Sentry org slug (optional; for source map upload). |
| `SENTRY_PROJECT` | Build | Sentry project slug (optional). |
| `SENTRY_AUTH_TOKEN` | Build / CI | Auth token for source map upload (optional; keep secret). |

### Smoke / test

| Variable | Where | Description |
|--------|--------|-------------|
| `WATCHTOWER_TEST_THROW` | Server + smoke script | Set to `1` to make `/api/watchtower/test-throw` throw (500). Used by smoke to verify error path + `x-request-id`. |
| `PROOF_URL` | Smoke script | Base URL (default `http://localhost:3000`). |

## How to verify

1. **Health**
   - `GET /api/health` → `{ ok: true, ts, git_sha?, db_ok? }`, response header `x-request-id` present.
   - Run: `npm run smoke:watchtower` (app must be running).

2. **Error-tracking integration (test-throw)**
   - Start app with `WATCHTOWER_TEST_THROW=1`.
   - `GET /api/watchtower/test-throw` → 500, header `x-request-id` present.
   - Run: `WATCHTOWER_TEST_THROW=1 node scripts/smoke/watchtower-proof.mjs` (app must be running with `WATCHTOWER_TEST_THROW=1`).
   - We cannot verify Sentry delivery offline; the smoke verifies that the endpoint throws, returns 500, and that the integration hooks run (“captured error”).

3. **Sentry/GlitchTip**
   - Set `NEXT_PUBLIC_SENTRY_DSN` (and optionally server DSN / org/project).
   - Trigger an error (e.g. test-throw or a real failure); confirm the issue appears in your Sentry/GlitchTip project.

## PII safety

- **beforeSend** (client, server, edge) scrubs:
  - Full IP → `[IP]`
  - Full fingerprint → `[FINGERPRINT]`
  - Full phone (in message, extra, exception) → masked (e.g. `+90***34`)
- `sendDefaultPii` is `false`; we do not send full IP, full fingerprint, or full phone.

## Routes covered

- **Server API:** `sync`, `seal`, `call-event`, `intents/[id]/status` — errors logged and sent to Sentry via `Sentry.captureException` in catch blocks.
- **Client (dashboard-v2):** Unhandled errors and React render errors are captured by the Sentry client (instrumentation-client) and `app/global-error.tsx`.
